import './globals.css';
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
      <body>
        <AuthProvider>
          <HeaderNav />
          <main>
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}



