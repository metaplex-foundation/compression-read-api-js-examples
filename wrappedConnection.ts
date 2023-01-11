import { AnchorProvider } from "@project-serum/anchor";
import NodeWallet from "@project-serum/anchor/dist/cjs/nodewallet";
import { Connection, Keypair } from "@solana/web3.js";
import axios from "axios";

export class WrappedConnection extends Connection {
  axiosInstance: any;
  provider: AnchorProvider;
  payer: Keypair;
  constructor(payer: Keypair, connectionString: string, rpcUrl?: string) {
    super(connectionString, "confirmed");
    this.axiosInstance = axios.create({
      baseURL: rpcUrl ?? connectionString,
    });
    this.provider = new AnchorProvider(
      new Connection(connectionString),
      new NodeWallet(payer),
      {
        commitment: super.commitment,
        skipPreflight: true,
      }
    );
    this.payer = payer;
  }

  async getAsset(assetId: any): Promise<any> {
    try {
      const response = await this.axiosInstance.post("get_asset", {
        jsonrpc: "2.0",
        method: "getAsset",
        id: "rpd-op-123",
        params: {
          id: assetId
        },
      });
      return response.data.result;
    } catch (error) {
      console.error(error);
    }
  }

  async getAssetProof(assetId: any): Promise<any> {
    try {
      const response = await this.axiosInstance.post("get_asset_proof", {
        jsonrpc: "2.0",
        method: "getAssetProof",
        id: "rpd-op-123",
        params: {
          id: assetId
        },
      });
      return response.data.result;
    } catch (error) {
      console.error(error);
    }
  }

  async getAssetsByOwner(
    assetId: string,
    sortBy: any,
    limit: number,
    page: number,
    before: string,
    after: string
  ): Promise<any> {
    try {
      const response = await this.axiosInstance.post("get_assets_by_owner", {
        jsonrpc: "2.0",
        method: "get_assets_by_owner",
        id: "rpd-op-123",
        params: [assetId, sortBy, limit, page, before, after],
      });
      return response.data.result;
    } catch (error) {
      console.error(error);
    }
  }
}
