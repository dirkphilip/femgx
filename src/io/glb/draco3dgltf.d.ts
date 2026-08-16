declare module "draco3dgltf" {
  export interface DracoDecoderOptions {
    readonly locateFile?: (file: string) => string;
    readonly wasmBinary?: Uint8Array;
  }

  interface Draco3d {
    createDecoderModule(options?: DracoDecoderOptions): Promise<unknown>;
  }

  const draco3d: Draco3d;
  export default draco3d;
}

declare module "*.wasm?url" {
  const url: string;
  export default url;
}
