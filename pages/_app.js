import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import CloverBar from '../components/CloverBar';

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const isLogin = router.pathname === '/login';
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Clover · B2C Tracker</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <style dangerouslySetInnerHTML={{ __html: 'html,body{margin:0}' }} />
      {isLogin ? null : <CloverBar currentApp="b2c" />}
      <Component {...pageProps} />
    </>
  );
}
