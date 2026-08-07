import HeaderNav from './components/HeaderNav';

export const metadata = {
  title: 'RTrader | Degen Launchpad, Trading Terminal & AI Agent Platform',
  description: 'Decision-complete execution platform for crypto launchpads, Binance trading terminal, and proposal-only AI agents.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Inter, system-ui, sans-serif', backgroundColor: '#0B0E14', color: '#F3F4F6' }}>
        <HeaderNav />
        <main style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
          {children}
        </main>
      </body>
    </html>
  );
}

