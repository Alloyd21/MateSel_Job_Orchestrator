import { useEffect, useRef, useState } from 'react'

export function LogViewer({ lines }: { lines: string[] }): JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' })
    }
  }, [lines, autoScroll])

  const handleScroll = (): void => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto bg-black rounded-lg p-3 font-mono text-xs text-green-400 leading-relaxed"
    >
      {lines.length === 0 ? (
        <span className="text-slate-500 italic">No output yet...</span>
      ) : (
        lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {line}
          </div>
        ))
      )}
      <div ref={bottomRef} />
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true)
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
          }}
          className="fixed bottom-6 right-6 bg-blue-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg hover:bg-blue-500"
        >
          Jump to bottom
        </button>
      )}
    </div>
  )
}
