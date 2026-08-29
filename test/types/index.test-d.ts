import {
  DuplicatePendingRequestError,
  PendingRequests,
  type PendingRequestOptions,
} from "../../src/index.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

const registry = new PendingRequests<string, number, { owner: string }>();
const promise = registry.register("id", { metadata: { owner: "worker" } });
export type PromiseResult = Expect<Equal<typeof promise, Promise<number>>>;
export type MetadataResult = Expect<
  Equal<ReturnType<typeof registry.metadata>, { owner: string } | undefined>
>;

registry.resolve("id", 1);
// @ts-expect-error result type is number
registry.resolve("id", "wrong");
// @ts-expect-error ID type is string
registry.register(1);
// @ts-expect-error owner is required by its object type when metadata is provided
registry.register("bad", { metadata: {} });

const defaultRegistry = new PendingRequests();
defaultRegistry.register("string");
defaultRegistry.register(1);
// @ts-expect-error default IDs are string or number
defaultRegistry.register({ id: 1 });

const objectId = { id: 1 };
const objectRegistry = new PendingRequests<typeof objectId, boolean>();
objectRegistry.register(objectId);
objectRegistry.resolve(objectId, true);

const options: PendingRequestOptions<{ trace: string }> = {
  metadata: { trace: "abc" },
  timeout: false,
};
void options;

const duplicate = new DuplicatePendingRequestError("id");
export type DuplicateId = Expect<Equal<typeof duplicate.id, string>>;
