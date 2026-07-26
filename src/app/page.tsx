import { redirect } from "next/navigation";

// Unauthenticated visitors never reach this component — proxy.ts already
// redirects them to /login before render. Anyone who does reach `/` is
// logged in, so send them straight to the one thing there is to see.
export default function Home() {
  redirect("/documents");
}
