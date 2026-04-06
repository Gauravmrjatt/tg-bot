import mongoose from "mongoose";

export async function connectDb(uri: string) {
  if (mongoose.connection.readyState >= 1) return;
  return mongoose.connect(uri);
}
