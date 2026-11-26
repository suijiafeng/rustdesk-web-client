import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pbjs } from 'protobufjs-cli';
import type { Plugin } from 'vite';
import { PROTO_SOURCE } from '../shared/protoSource.ts';

const schemaModule = fileURLToPath(new URL('../server/protoSchema.ts', import.meta.url));
const virtualModule = '\0rustdesk:static-protobuf';

// The Node gateway keeps reflection. Browsers need static constructors because
// protobufjs reflection compiles serializers with Function, blocked by our CSP.
async function generateBrowserSchema(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'rustdesk-protobuf-'));
  try {
    const sourceFile = path.join(directory, 'rustdesk.proto');
    await writeFile(sourceFile, PROTO_SOURCE);
    const generated = await new Promise<string>((resolve, reject) => {
      pbjs.main([
        '--target', 'static-module', '--wrap', 'esm', '--root', 'rustdeskWeb',
        '--keep-case', '--no-comments', '--no-service', sourceFile,
      ], (error, output) => {
        if (error) reject(error);
        else if (typeof output !== 'string') reject(new Error('Protobuf generation returned no source'));
        else resolve(output);
      });
    });
    return `${generated}
export const protoRoot = $root;
export const MessageProto = $root.rustdesk.Message;
export const IdPkProto = $root.rustdesk.IdPk;
export const RendezvousMessageProto = $root.rustdesk.RendezvousMessage;
export const KxParamsProto = $root.rustdesk.KxParams;
export const ControlKeyValues = $root.rustdesk.ControlKey;
export const KeyboardModeValues = $root.rustdesk.KeyboardMode;
export const ImageQualityValues = $root.rustdesk.ImageQuality;
export const BoolOptionValues = $root.rustdesk.OptionMessage.BoolOption;
export const PreferCodecValues = $root.rustdesk.SupportedDecoding.PreferCodec;
export const ChromaValues = $root.rustdesk.Chroma;
export const NatTypeValues = $root.rustdesk.NatType;
export const ConnTypeValues = $root.rustdesk.ConnType;
export const PunchFailureValues = $root.rustdesk.PunchHoleResponse.Failure;
`;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function browserProtobuf(): Plugin {
  let generated: Promise<string> | undefined;
  return {
    name: 'rustdesk-browser-protobuf',
    enforce: 'pre',
    resolveId(source, importer, options) {
      if (options.ssr) return;
      if (source === virtualModule) return virtualModule;
      if (importer && path.resolve(path.dirname(importer), source) === schemaModule) return virtualModule;
    },
    load(id) {
      if (id !== virtualModule) return;
      // PROTO_SOURCE is a Vite config dependency: edits restart the dev server
      // and regenerate this module, so no generated files can become stale.
      return generated ??= generateBrowserSchema().catch(error => {
        generated = undefined;
        throw error;
      });
    },
  };
}
