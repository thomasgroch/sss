import { capsule } from "lakebed/server";

// The simulator runs entirely in the browser. No database, no auth required.
export default capsule({
  name: "SaaS Subscription Simulator",
  auth: { requireSignIn: false }
});
