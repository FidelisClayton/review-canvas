import { describe, expect, it } from "vitest";
import { encodePath } from "./github.js";

describe("encodePath", () => {
  it("keeps the slashes and encodes what could change the query", () => {
    expect(encodePath("app/a b/c?ref=x#d&e.rb")).toBe("app/a%20b/c%3Fref%3Dx%23d%26e.rb");
  });
});

// The transport stays injectable while production reads still use the reviewer's gh login.
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { vi } from "vitest";
import { fetchExactTree, githubReadTransport, GhError } from "./github.js";
vi.mock("node:child_process", async original => ({...(await original<typeof import("node:child_process")>()), spawn: vi.fn()}));
const ref = {owner: "acme", repo: "example", number: 1};
function fakeGh(output: Buffer) {
  const child = Object.assign(new EventEmitter(), {stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn()});
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  queueMicrotask(() => {child.stdout.emit("data", output); child.emit("close", 0);});
  return child;
}
describe("exact GitHub reads", () => {
  it("bounds source bytes before accumulating an oversized gh response", async () => {
    const child = fakeGh(Buffer.alloc(1024 * 1024 + 1, "x"));
    const error = await githubReadTransport.readFile(ref, "a".repeat(40), "a?ref=main.ts").then(() => null, (error: unknown) => error);
    expect(error).toBeInstanceOf(GhError);
    expect((error as Error).message).toMatch(/limit|large/i);
    expect(child.kill).toHaveBeenCalled();
    expect(vi.mocked(spawn).mock.calls.at(-1)?.[1]).toContain(`repos/acme/example/contents/a%3Fref%3Dmain.ts?ref=${"a".repeat(40)}`);
  });
  it("retains an exact permitted response without a fallback", async () => {
    fakeGh(Buffer.from("source\n")); expect(await githubReadTransport.readFile(ref, "a".repeat(40), "source.ts")).toBe("source\n");
  });
  it("preserves UTF-8 split across process chunks", async () => {
    const child = Object.assign(new EventEmitter(), {stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn()});
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
    queueMicrotask(() => {child.stdout.emit("data", Buffer.from([0xc3])); child.stdout.emit("data", Buffer.from([0xa9])); child.emit("close", 0);});
    expect(await githubReadTransport.readFile(ref, "a".repeat(40), "source.ts")).toBe("é");
  });
  it("fails rather than treating a truncated nonrecursive tree as complete", async () => {
    await expect(fetchExactTree(ref, "a".repeat(40), {readTree: async () => ({tree: [], truncated: true})})).rejects.toBeInstanceOf(GhError);
  });
});
