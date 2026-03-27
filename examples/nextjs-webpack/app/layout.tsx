export const metadata = {
  title: 'Next.js MCP Test App (webpack)',
  description: 'Testing web-dev-mcp-gateway with webpack mode',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  )
}
