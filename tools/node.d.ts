// The few Node APIs the tools use, declared here because the project has no @types/node.
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function realpathSync(path: string): string;
  export function readdirSync(path: string, options: { recursive: boolean; encoding: 'utf8' }): string[];
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
