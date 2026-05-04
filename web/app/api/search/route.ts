import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

// Statically cached at build time so this route works under
// `output: "export"`. The exported JSON is fetched by the static
// search client in fumadocs-ui's RootProvider.
export const revalidate = false;

export const { staticGET: GET } = createFromSource(source);
