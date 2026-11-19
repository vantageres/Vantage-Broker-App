import { getStore } from "../store";
import { emptyDirectory, type Directory } from "./scan";
import { sealer } from "./server";

// Where the broker's directory lives: sealed in the store, no timer. It stays
// while the broker has the module on and is deleted on Disconnect (plan
// decision 6).
const directoryKey = (userId: string) => `email:directory:${userId}`;

export async function directoryFor(userId: string): Promise<Directory> {
  const sealed = await getStore().get<string>(directoryKey(userId));
  return (sealed ? await sealer.unseal<Directory>(sealed) : null) ?? emptyDirectory();
}

export async function saveDirectory(userId: string, directory: Directory) {
  await getStore().set(directoryKey(userId), await sealer.seal(directory));
}

export async function deleteDirectoryOnly(userId: string) {
  await getStore().del(directoryKey(userId));
}
