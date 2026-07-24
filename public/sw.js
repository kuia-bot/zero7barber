self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Zero7Barber';
  const options = {
    body: data.body || 'Novo agendamento!',
    icon: '/zero7barber/icon-192.png',
    badge: '/zero7barber/icon-192.png',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(clients.openWindow('/zero7barber/'));
});