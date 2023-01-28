import {
  bufferToArray,
  execute,
  getBubblegumAuthorityPDA,
  mapProof,
} from "../helpers";
import { Keypair, PublicKey } from "@solana/web3.js";
import { WrappedConnection } from "../wrappedConnection";
import { bs58 } from "@project-serum/anchor/dist/cjs/utils/bytes";
import {
  createTransferInstruction,
  PROGRAM_ID as BUBBLEGUM_PROGRAM_ID,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  ConcurrentMerkleTreeAccount,
} from "@solana/spl-account-compression";
import { RPC_URL, CONNECTION_STRING } from "../constants";
import { BN } from "@project-serum/anchor";

export const transferAsset = async (
  source: Keypair,
  destination: PublicKey,
  merkleTree: PublicKey
) => {
  const rpcUrl = RPC_URL;
  const connectionString = CONNECTION_STRING;

  const connectionWrapper = new WrappedConnection(
    source,
    connectionString,
    rpcUrl
  );

  let mkAccount = await ConcurrentMerkleTreeAccount.fromAccountAddress(
    connectionWrapper,
    merkleTree
  );

  let canopyHeight = mkAccount.getCanopyDepth();
  const leafIndex = new BN.BN(0);
  // grabbing the asset id so that it can be passed to transfer
  const [assetId] = await PublicKey.findProgramAddress(
    [
      Buffer.from("asset", "utf8"),
      merkleTree.toBuffer(),
      Uint8Array.from(leafIndex.toArray("le", 8)),
    ],
    BUBBLEGUM_PROGRAM_ID
  );

  const assetString = assetId.toBase58();

  let assetProof = await connectionWrapper.getAssetProof(assetString);
  let proofPath = mapProof(assetProof);
  const rpcAsset = await connectionWrapper.getAsset(assetString);

  const leafNonce = rpcAsset.compression.leaf_id;
  const treeAuthority = await getBubblegumAuthorityPDA(
    new PublicKey(assetProof.tree_id)
  );
  const leafDelegate = rpcAsset.ownership.delegate
    ? new PublicKey(rpcAsset.ownership.delegate)
    : new PublicKey(rpcAsset.ownership.owner);
  let transferIx = createTransferInstruction(
    {
      treeAuthority,
      leafOwner: new PublicKey(rpcAsset.ownership.owner),
      leafDelegate: leafDelegate,
      newLeafOwner: destination,
      merkleTree: new PublicKey(assetProof.tree_id),
      logWrapper: SPL_NOOP_PROGRAM_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
      anchorRemainingAccounts: proofPath.slice(
        0,
        proofPath.length - (!!canopyHeight ? canopyHeight : 0)
      ),
    },
    {
      root: bufferToArray(bs58.decode(assetProof.root)),
      dataHash: bufferToArray(
        bs58.decode(rpcAsset.compression.data_hash.trim())
      ),
      creatorHash: bufferToArray(
        bs58.decode(rpcAsset.compression.creator_hash.trim())
      ),
      nonce: leafNonce,
      index: leafNonce,
    }
  );
  const txid = await execute(
    connectionWrapper.provider,
    [transferIx],
    [connectionWrapper.payer],
    true
  );

  return txid;
};
