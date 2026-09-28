const mongoose = require("mongoose");
const dotenv = require("dotenv");
const dns = require("dns");

dotenv.config();

// Some networks (corporate DNS, certain ISPs) refuse SRV queries, which breaks
// mongodb+srv:// host resolution. Fall back to public resolvers when the
// system resolver cannot answer the SRV record.
const FALLBACK_DNS = ["8.8.8.8", "1.1.1.1"];

const ensureSrvResolvable = (uri) => {
  if (!uri.startsWith("mongodb+srv://")) return Promise.resolve();

  const authority = uri.slice("mongodb+srv://".length).split("/")[0];
  const atIndex = authority.lastIndexOf("@");
  const host = (atIndex === -1 ? authority : authority.slice(atIndex + 1))
    .split(":")[0];
  const record = `_mongodb._tcp.${host}`;

  return new Promise((resolve) => {
    dns.resolveSrv(record, (err) => {
      if (!err) return resolve();

      console.warn(
        `SRV lookup for ${host} failed via system DNS (${err.code}). Using fallback resolvers ${FALLBACK_DNS.join(", ")}.`
      );
      dns.setServers(FALLBACK_DNS);
      resolve();
    });
  });
};

const RETRY_DELAY_MS = 5000;
const MAX_RETRIES = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readUri = () => {
  const uri = (process.env.MONGO_URI || "").trim();
  if (!uri) {
    throw new Error(
      "MONGO_URI is not set. Add it to your .env file, e.g. MONGO_URI=mongodb+srv://<user>:<password>@<cluster>/<db>"
    );
  }
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new Error(
      "MONGO_URI must start with mongodb:// or mongodb+srv://. Check for stray quotes, a leading space, or a truncated line in .env"
    );
  }
  return uri;
};

const connectDB = async () => {
  const uri = readUri();
  await ensureSrvResolvable(uri);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const conn = await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
      });
      console.log(`MongoDB connected: ${conn.connection.host}`);
      return conn;
    } catch (err) {
      const isLastAttempt = attempt === MAX_RETRIES;
      console.error(
        `MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`
      );
      if (isLastAttempt) throw err;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
};

module.exports = connectDB;
