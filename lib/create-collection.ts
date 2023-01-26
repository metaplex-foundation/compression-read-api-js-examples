import { execute } from "../helpers";
import {
  PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID,
  createCreateMetadataAccountV3Instruction,
  createCreateMasterEditionV3Instruction,
  createSetCollectionSizeInstruction,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
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

export const createCollection = async (
  connectionWrapper: WrappedConnection,
  payerKeypair: Keypair,
  compressedNFT: MetadataArgs,
  merkleTree: PublicKey
) => {
  const payer = payerKeypair.publicKey;
  const [treeAuthority, _bump] = await PublicKey.findProgramAddress(
    [merkleTree.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  );
  const [bgumSigner, __] = await PublicKey.findProgramAddress(
    [Buffer.from("collection_cpi", "utf8")],
    BUBBLEGUM_PROGRAM_ID
  );
  const collectionMint = await createMint(
    connectionWrapper,
    payerKeypair,
    payer,
    payer,
    0
  );

  const collectionMintAccount = await getOrCreateAssociatedTokenAccount(
    connectionWrapper,
    payerKeypair,
    collectionMint,
    payerKeypair.publicKey
  );

  const [collectionMasterEditionAccount, _b2] =
    await PublicKey.findProgramAddress(
      [
        Buffer.from("metadata", "utf8"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        collectionMint.toBuffer(),
        Buffer.from("edition", "utf8"),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

  await mintTo(
    connectionWrapper,
    payerKeypair,
    collectionMint,
    collectionMintAccount.address,
    payerKeypair.publicKey,
    1,
    []
  );

  const [colectionMetadataAccount, _b] = await PublicKey.findProgramAddress(
    [
      Buffer.from("metadata", "utf8"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      collectionMint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  const collectionMeatadataIX = createCreateMetadataAccountV3Instruction(
    {
      metadata: colectionMetadataAccount,
      mint: collectionMint,
      mintAuthority: payer,
      payer,
      updateAuthority: payer,
    },
    {
      createMetadataAccountArgsV3: {
        // update NFT metadata here, passing `compressedNFT` over using hardcoded
        data: {
          name: "Degen Ape #1338",
          symbol: "DAA",
          uri: "https://arweave.net/gfO_TkYttQls70pTmhrdMDz9pfMUXX8hZkaoIivQjGs",
          sellerFeeBasisPoints: 100,
          creators: null,
          collection: null,
          uses: null,
        },
        isMutable: false,
        collectionDetails: null,
      },
    }
  );

  const collectionMasterEditionIX = createCreateMasterEditionV3Instruction(
    {
      edition: collectionMasterEditionAccount,
      mint: collectionMint,
      updateAuthority: payer,
      mintAuthority: payer,
      payer: payer,
      metadata: colectionMetadataAccount,
    },
    {
      createMasterEditionArgs: {
        maxSupply: 0,
      },
    }
  );

  const sizeCollectionIX = createSetCollectionSizeInstruction(
    {
      collectionMetadata: colectionMetadataAccount,
      collectionAuthority: payer,
      collectionMint: collectionMint,
    },
    {
      setCollectionSizeArgs: { size: 0 },
    }
  );
  const mintIx = createMintToCollectionV1Instruction(
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
      collectionMint: collectionMint,
      collectionMetadata: colectionMetadataAccount,
      editionAccount: collectionMasterEditionAccount,
      bubblegumSigner: bgumSigner,
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
    },
    {
      metadataArgs: Object.assign(compressedNFT, {
        collection: { key: collectionMint, verified: false },
      }),
    }
  );
  await execute(
    connectionWrapper.provider,
    [
      collectionMeatadataIX,
      collectionMasterEditionIX,
      sizeCollectionIX,
      mintIx,
    ],
    [payerKeypair]
  );

  return collectionMint;
};
