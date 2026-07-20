import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGODB_URL ?? "mongodb://127.0.0.1:27017/cellix";
const dbName = process.env.MONGODB_DB_NAME ?? "cellix";

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function createClient(): Promise<MongoClient> {
  const client = new MongoClient(uri);
  return client.connect();
}

const clientPromise =
  process.env.NODE_ENV === "development"
    ? (global._mongoClientPromise ??= createClient())
    : createClient();

export async function getDb(): Promise<Db> {
  const client = await clientPromise;
  return client.db(dbName);
}
