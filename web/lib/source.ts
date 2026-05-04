import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";
import * as lucide from "lucide-react";
import { createElement } from "react";

const lookup = lucide as unknown as Record<string, React.ComponentType>;

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  icon(icon) {
    if (!icon) return;
    const Component =
      (icon in lucide.icons
        ? lucide.icons[icon as keyof typeof lucide.icons]
        : undefined) ?? lookup[icon];
    if (Component) return createElement(Component);
  },
});
