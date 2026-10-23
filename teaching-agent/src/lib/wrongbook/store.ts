import { createPersistentStore, localStorageAdapter } from "../self-test/persistence";
import { decodeWrongbook, EMPTY_WRONGBOOK } from "./model";
export const WRONGBOOK_STORAGE_KEY = "ch6-wrongbook-v1";
export const wrongbookStore = createPersistentStore(localStorageAdapter(WRONGBOOK_STORAGE_KEY, EMPTY_WRONGBOOK, decodeWrongbook), EMPTY_WRONGBOOK, "错题本");
