import HeaderNav from './components/HeaderNav';
import { AuthProvider } from './context/AuthContext';

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
      <body style={{ margin: 0, fontFamily: 'Inter, system-ui, sans-serif', backgroundColor: '#000000', color: '#E2E8F0', minHeight: '100vh' }}>
        <AuthProvider>
          <HeaderNav />
          <main style={{ padding: '16px', maxWidth: '1600px', margin: '0 auto' }}>
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}



