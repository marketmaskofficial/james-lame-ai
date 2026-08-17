import { lazy, Suspense } from "react";

type Props = { value: string; onChange: (v: string) => void; height?: string };

// CodeMirror + the JS parser load lazily, and only in the browser.
const Editor = lazy(async () => {
  const [{ default: CM }, { javascript }, { oneDark }, { EditorView }] = await Promise.all([
    import("@uiw/react-codemirror"),
    import("@codemirror/lang-javascript"),
    import("@codemirror/theme-one-dark"),
    import("@codemirror/view"),
  ]);
  // Match the editor's surface to the app's own panel color and tighten line
  // height, so it reads as part of the dock instead of an embedded widget
  // with its own visibly different background.
  const surface = EditorView.theme({
    "&": { backgroundColor: "var(--panel)" },
    ".cm-gutters": { backgroundColor: "var(--panel)" },
    ".cm-line": { lineHeight: "1.4" },
  });
  const extensions = [javascript(), surface];
  return {
    default: ({ value, onChange, height = "100%" }: Props) => (
      <CM
        value={value}
        height={height}
        theme={oneDark}
        extensions={extensions}
        basicSetup={{ lineNumbers: true, foldGutter: false }}
        onChange={onChange}
        style={{ fontSize: 12, height: "100%" }}
      />
    ),
  };
});

export function CodeEditor(props: Props) {
  return (
    <Suspense
      fallback={
        <textarea
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          spellCheck={false}
          className="h-full w-full resize-none bg-transparent p-3 font-mono text-xs text-foreground outline-none"
        />
      }
    >
      <Editor {...props} />
    </Suspense>
  );
}
