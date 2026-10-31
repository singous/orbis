import path from "node:path";
import { verifyLicenseBundle } from "./license-bundle.mjs";

const directory = path.resolve(process.argv[2] ?? "dist/licenses");
console.log(JSON.stringify(verifyLicenseBundle(directory), null, 2));
