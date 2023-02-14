import { execute } from "../helpers";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { WrappedConnection } from "../wrappedConnection";
import {
  createCreateTreeInstruction,
  PROGRAM_ID as BUBBLEGUM_PROGRAM_ID,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  getConcurrentMerkleTreeAccountSize,
  SPL_NOOP_PROGRAM_ID,
} from "@solana/spl-account-compression";
import { RPC_URL, CONNECTION_STRING } from "../constants";

export const createTree = async (payer: Keypair) => {
  const rpcUrl = RPC_URL;
  const connectionString = CONNECTION_STRING;
  const maxDepth = 14;
  const maxBufferSize = 64;

  const connectionWrapper = new WrappedConnection(
    payer,
    connectionString,
    rpcUrl
  );
  const merkleTreeKeypair = Keypair.generate();
  const merkleTree = merkleTreeKeypair.publicKey;
  const space = getConcurrentMerkleTreeAccountSize(maxDepth, maxBufferSize, 5);
  const allocTreeIx = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: merkleTree,
    lamports: await connectionWrapper.getMinimumBalanceForRentExemption(space),
    space: space,
    programId: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  });
  const [treeAuthority, _bump] = await PublicKey.findProgramAddress(
    [merkleTree.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  );
  const createTreeIx = createCreateTreeInstruction(
    {
      merkleTree,
      treeAuthority,
      treeCreator: payer.publicKey,
      payer: payer.publicKey,
      logWrapper: SPL_NOOP_PROGRAM_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    },
    {
      maxBufferSize,
      maxDepth,
      public: false,
    },
    BUBBLEGUM_PROGRAM_ID
  );
  await execute(
    connectionWrapper.provider,
    [allocTreeIx, createTreeIx],
    [merkleTreeKeypair, payer]
  );

  return merkleTree;
};
