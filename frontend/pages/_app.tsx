import type { AppProps } from "next/app";
import { Geist, Geist_Mono } from "next/font/google";
import Navigation from "../components/Navigation";
import { AuthProvider } from "../lib/auth";
import "../styles/globals.scss";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`${geistSans.variable} ${geistMono.variable}`}>
      <AuthProvider>
        <Navigation />
        <br />
        <Component {...pageProps} />
      </AuthProvider>
    </div>
  );
}
