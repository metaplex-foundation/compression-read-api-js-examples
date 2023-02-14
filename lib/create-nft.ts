import {
  execute,
  createIxns,
  createCollection,
  getMasterEditionAccount,
  getMetadataAccount,
} from "../helpers";
import { PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";
import { Keypair, PublicKey } from "@solana/web3.js";
import { WrappedConnection } from "../wrappedConnection";
import {
  PROGRAM_ID as BUBBLEGUM_PROGRAM_ID,
  createMintToCollectionV1Instruction,
  MetadataArgs,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
} from "@solana/spl-account-compression";
import { RPC_URL, CONNECTION_STRING } from "../constants";

export const createNFT = async (
  payerKeypair: Keypair,
  compressedNFT: MetadataArgs,
  merkleTree: PublicKey,
  collectionMint?: PublicKey
) => {
  const rpcUrl = RPC_URL;
  const connectionString = CONNECTION_STRING;
  const payer = payerKeypair.publicKey;
  const connectionWrapper = new WrappedConnection(
    payerKeypair,
    connectionString,
    rpcUrl
  );

  // creating new mint address, if not provided already
  let collectionMintAddress: PublicKey;
  if (collectionMint) {
    collectionMintAddress = collectionMint;
  } else {
    collectionMintAddress = await createCollection(payerKeypair);
  }

  const collectionMasterEditionAccount = await getMasterEditionAccount(
    collectionMintAddress
  );
  const colectionMetadataAccount = await getMetadataAccount(
    collectionMintAddress
  );

  const [treeAuthority, _bump] = await PublicKey.findProgramAddress(
    [merkleTree.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  );
  const [bgumSigner, __] = await PublicKey.findProgramAddress(
    [Buffer.from("collection_cpi", "utf8")],
    BUBBLEGUM_PROGRAM_ID
  );

  const mintIx = await createIxns(payerKeypair, collectionMintAddress);

  mintIx.push(
    createMintToCollectionV1Instruction(
      {
        merkleTree,
        treeAuthority,
        treeDelegate: payer,
        payer,
        leafDelegate: payer,
        leafOwner: payer,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        collectionAuthority: payer,
        collectionAuthorityRecordPda: BUBBLEGUM_PROGRAM_ID,
        collectionMint: collectionMintAddress,
        collectionMetadata: colectionMetadataAccount,
        editionAccount: collectionMasterEditionAccount,
        bubblegumSigner: bgumSigner,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      },
      {
        metadataArgs: Object.assign(compressedNFT, {
          collection: { key: collectionMintAddress, verified: false },
        }),
      }
    )
  );

  await execute(connectionWrapper.provider, mintIx, [payerKeypair]);

  return collectionMintAddress;
};
