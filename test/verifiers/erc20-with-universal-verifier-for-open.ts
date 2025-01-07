import { Blockchain, buildDIDType, DidMethod, NetworkId } from '@iden3/js-iden3-core';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';
import { StateDeployHelper } from '../helpers/StateDeployHelper';
import {
  deployERC20LinkedUniversalVerifier,
  deployValidatorContracts,
  prepareInputs,
  publishState
} from '../utils/deploy-utils';
import {
  buildCrossChainProofs,
  packCrossChainProofs,
  packV2ValidatorParams,
  packZKProof,
  unpackV2ValidatorParams
} from '../utils/pack-utils';

const tenYears = 315360000;

const query = {
  schema: BigInt('180410020913331409885634153623124536270'),
  claimPathKey: BigInt(
    '8566939875427719562376598811066985304309117528846759529734201066483458512800'
  ),
  operator: BigInt(1),
  slotIndex: BigInt(0),
  value: ['1420070400000000000', ...new Array(63).fill('0')].map((x) => BigInt(x)),
  circuitIds: [''],
  queryHash: BigInt('7854321536597559201098551954568590097739874725708651207094499063296207596002'),
  claimPathNotExists: 0,
  metadata: 'test medatada',
  skipClaimRevocationCheck: false
};

describe('ERC 20 test for open', function () {
  let state: any, sig: any, mtp: any;
  let universalVerifier: Contract, erc20LinkedUniversalVerifier: Contract;

  before(async () => {
    const typ0 = buildDIDType(DidMethod.Iden3, Blockchain.ReadOnly, NetworkId.NoNetwork);
    const typ1 = buildDIDType(DidMethod.Iden3, Blockchain.Polygon, NetworkId.Mumbai);
    //const typ2 = buildDIDType(DidMethod.PolygonId, Blockchain.Polygon, NetworkId.Amoy);
    const typ3 = buildDIDType(DidMethod.PolygonId, Blockchain.ReadOnly, NetworkId.NoNetwork);

    console.log('typ0:', typ0);
    console.log('typ1:', typ1);
    //console.log('typ2:', typ2);
    console.log('typ3:', typ3);
    const stateDeployHelper = await StateDeployHelper.initialize();
    ({ state } = await stateDeployHelper.deployState([typ0, typ1, typ3]));
    const stateAddress = await state.getAddress();
    const contractsSig = await deployValidatorContracts(
      'VerifierSigWrapper',
      'CredentialAtomicQuerySigV2Validator',
      stateAddress
    );
    sig = contractsSig.validator;

    const contractsMTP = await deployValidatorContracts(
      'VerifierMTPWrapper',
      'CredentialAtomicQueryMTPV2Validator',
      stateAddress
    );
    mtp = contractsMTP.validator;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    await publishState(state, require('./common-data/user_state_transition.json'));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    await publishState(state, require('./common-data/issuer_genesis_state.json'));

    ({ universalVerifier, erc20LinkedUniversalVerifier } = await deployERC20LinkedUniversalVerifier(
      'zkpVerifier',
      'ZKP',
      stateAddress
    ));

    await universalVerifier.addValidatorToWhitelist(await sig.getAddress());
    await universalVerifier.addValidatorToWhitelist(await mtp.getAddress());

    await setZKPRequests();

    await sig.setProofExpirationTimeout(tenYears);
    await mtp.setProofExpirationTimeout(tenYears);

    await sig.setGISTRootExpirationTimeout(tenYears);
    await mtp.setGISTRootExpirationTimeout(tenYears);
  });

  it('Example ERC20 Verifier: set zkp request Sig validator + submit zkp response V2', async () => {
    await erc20VerifierFlowV2('credentialAtomicQuerySigV2OnChain');
  });
  /*
  it('Example ERC20 Verifier: set zkp request Mtp validator + submit zkp response V2', async () => {
    await erc20VerifierFlowV2('credentialAtomicQueryMTPV2OnChain');
  });
*/
  async function setZKPRequests() {
    async function setRequest(requestId, query, validatorAddress) {
      await universalVerifier.setZKPRequest(requestId, {
        metadata: 'metadata',
        validator: validatorAddress,
        data: packV2ValidatorParams(query)
      });
    }

    const query2 = Object.assign({}, query);
    query2.circuitIds = ['credentialAtomicQuerySigV2OnChain'];
    query2.skipClaimRevocationCheck = false;
    await setRequest(0, query2, await sig.getAddress());

    query2.circuitIds = ['credentialAtomicQueryMTPV2OnChain'];
    query2.skipClaimRevocationCheck = true;
    await setRequest(1, query2, await mtp.getAddress());
  }

  async function checkValidatorQueryRequest(requestId, validator) {
    const query2 = Object.assign({}, query);
    query2.circuitIds = [validator];
    query2.skipClaimRevocationCheck =
      validator === 'credentialAtomicQuerySigV2OnChain' ? false : true;

    expect(requestId).to.be.equal(validator === 'credentialAtomicQuerySigV2OnChain' ? 0 : 1);

    const requestData = await universalVerifier.getZKPRequest(requestId);
    const parsedRD = unpackV2ValidatorParams(requestData.data);

    expect(parsedRD.queryHash.toString()).to.be.equal(query2.queryHash);
    expect(parsedRD.claimPathKey.toString()).to.be.equal(query2.claimPathKey.toString());
    expect(parsedRD.circuitIds[0].toString()).to.be.equal(query2.circuitIds[0].toString());
    expect(parsedRD.operator.toString()).to.be.equal(query2.operator.toString());
    expect(parsedRD.claimPathNotExists.toString()).to.be.equal(
      query2.claimPathNotExists.toString()
    );
  }

  async function erc20VerifierFlowV2(
    validator: 'credentialAtomicQueryMTPV2OnChain' | 'credentialAtomicQuerySigV2OnChain'
  ): Promise<void> {
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const bigint_root =
      4088184107595327986751778597634067060289926760850725885926101289244613707147n;
    console.log('erc20VerifierFlowV2() timestamp:', timestamp);
    console.log('erc20VerifierFlowV2() bigint_root:', bigint_root);
    const globalStateMessage = {
      timestamp: timestamp,
      idType: '0x0213', //'0x01A1',
      root: bigint_root, //0n,
      replacedAtTimestamp: 1736154273n
    };
    //curl http://localhost:8080/1.0/identifiers/did:polygonid:polygon:amoy:2qZYsH3XmWmC3PzHeWe7C3ahCVaEMUJbBYDo5NhEMb?gist=8B859C64C7FC3A8D60BA94BCF2015EA75D99FC5C1645E41A5D5CCF5E88D40909

    const identityStateMessage1 = {
      timestamp: timestamp,
      id: 25530185136167283063987925153802803371825564143650291260157676786685420033n,
      state: 4595702004868323299100310062178085028712435650290319955390778053863052230284n,
      replacedAtTimestamp: 0n
    };

    //curl http://localhost:8080/1.0/identifiers/did:iden3:polygon:amoy:xHbKLu59qbdhPRJGfZBMiCRv8bGMBvtHzhpEBRZZG?state=8B1B24F106EA6B54C3C5693668AAFF1757A2F78BDE40ECFFEC9996F61A585D22

    //https://www.mobilefish.com/services/big_number/big_number.php
    //https://www.save-editor.com/tools/wse_hex.html#littleendian

    /*
    const identityStateUpdate2 = {
      timestamp: timestamp,
      id: 25530185136167283063987925153802803371825564143650291260157676786685420033n,
      state: 16775015541053109108201708100382933592407720757224325883910784163897594100403n,
      replacedAtTimestamp: 1724858009n
    };
    */

    const { inputs, pi_a, pi_b, pi_c } = prepareInputs(
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      validator === 'credentialAtomicQuerySigV2OnChain'
        ? require('./common-data/sig_on_chain_test.json')
        : require('./common-data/valid_mtp_user_non_genesis_challenge_address.json')
    );

    const [signer] = await ethers.getSigners();
    const account = await signer.getAddress();

    // try transfer without given proof
    await expect(
      erc20LinkedUniversalVerifier.transfer('0x900942Fd967cf176D0c0A1302ee0722e1468f580', 1)
    ).to.be.revertedWith(
      'only identities who provided sig or mtp proof for transfer requests are allowed to receive tokens'
    );

    const requestId =
      validator === 'credentialAtomicQuerySigV2OnChain'
        ? await erc20LinkedUniversalVerifier.TRANSFER_REQUEST_ID_SIG_VALIDATOR()
        : await erc20LinkedUniversalVerifier.TRANSFER_REQUEST_ID_MTP_VALIDATOR();

    await checkValidatorQueryRequest(requestId, validator);

    const zkProof = packZKProof(inputs, pi_a, pi_b, pi_c);
    const crossChainProofs = packCrossChainProofs(
      await buildCrossChainProofs(
        [globalStateMessage, identityStateMessage1 /*, identityStateUpdate2*/],
        signer
      )
    );
    const metadatas = '0x';

    await universalVerifier.submitZKPResponseV2(
      [
        {
          requestId,
          zkProof: zkProof,
          data: metadatas
        }
      ],
      crossChainProofs
    );

    const proofStatus = await universalVerifier.getProofStatus(account, requestId);
    expect(proofStatus.isVerified).to.be.true; // check proof is assigned

    // check that tokens were minted
    const balanceBefore = await erc20LinkedUniversalVerifier.balanceOf(account);
    await erc20LinkedUniversalVerifier.mint(account);
    const balanceAfter = await erc20LinkedUniversalVerifier.balanceOf(account);
    expect(balanceAfter - balanceBefore).to.be.equal(BigInt('5000000000000000000'));

    // if proof is provided second time, address is not receiving airdrop tokens, but no revert
    await universalVerifier.submitZKPResponseV2(
      [
        {
          requestId,
          zkProof: zkProof,
          data: metadatas
        }
      ],
      crossChainProofs
    );

    await erc20LinkedUniversalVerifier.transfer(account, 1); // we send tokens to ourselves, but no error because we sent proof
  }
});
