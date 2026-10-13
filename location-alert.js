/* Alerta visual de ubicación: no altera la validación de 50 metros. */
(function () {
  'use strict';

  const modal = document.getElementById('locationAlert');
  const message = document.getElementById('locationAlertMessage');
  const distance = document.getElementById('locationAlertDistance');
  const closeButton = document.getElementById('locationAlertClose');
  const retryButton = document.getElementById('locationAlertRetry');
  const previousFocus = { element: null };

  function open(text) {
    previousFocus.element = document.activeElement;
    message.textContent = text;
    const match = text.match(/distancia estimada\s*:\s*([\d.,]+)\s*m/i);
    distance.textContent = match ? match[1] + ' m' : 'Fuera del área permitida';
    modal.hidden = false;
    closeButton.focus();
  }

  function close() {
    modal.hidden = true;
    if (previousFocus.element && previousFocus.element.focus) {
      previousFocus.element.focus();
    }
  }

  closeButton.addEventListener('click', close);
  modal.addEventListener('click', function (event) {
    if (event.target === modal) close();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !modal.hidden) close();
  });

  retryButton.addEventListener('click', async function () {
    retryButton.disabled = true;
    retryButton.textContent = 'Comprobando…';
    try {
      // Revalida la ubicación, pero NO crea una marcación.
      const result = await verifyWorkplace();
      close();
      showError('Ubicación verificada: a ' + Math.round(result.distance) + ' m de Bon House. Ya puedes intentar marcar.');
    } catch (error) {
      open(typeof errorText === 'function' ? errorText(error) : String(error.message || error));
    } finally {
      retryButton.disabled = false;
      retryButton.textContent = 'Reintentar ubicación';
    }
  });

  window.TimeCoreLocationAlert = { open, close };
})();
