// sw.js — service worker mínimo: só existe para o jogo poder ser instalado como app.
// De propósito, NÃO guarda nada em cache: o jogo é online e sempre carrega a versão mais nova.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
