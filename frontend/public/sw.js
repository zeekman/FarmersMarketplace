self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Farmers Marketplace';
  const options = {
    body: data.body || 'You have a new notification',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: data.url || '/',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data || '/';
  event.waitUntil(clients.openWindow(targetUrl));
});
