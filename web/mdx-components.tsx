import defaultMdxComponents from "fumadocs-ui/mdx";
import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import type { MDXComponents } from "mdx/types";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    img: (props) => <ImageZoom {...(props as React.ComponentProps<typeof ImageZoom>)} />,
    ...components,
  };
}
