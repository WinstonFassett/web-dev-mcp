import { WebDevMcpInit } from './WebDevMcpInit'

export const metadata = {
  title: 'Next.js MCP Test App',
  description: 'Testing next-live-dev-mcp',
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
