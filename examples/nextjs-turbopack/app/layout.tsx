import { WebDevMcpInit } from '@winstonfassett/web-dev-mcp-nextjs/init'

export const metadata = {
  title: 'Next.js MCP Test App (turbopack)',
  description: 'Testing web-dev-mcp-gateway with Turbopack',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <WebDevMcpInit />
        {children}
      </body>
    </html>
  )
}
