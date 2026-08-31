(() => {
  const status = document.getElementById('checkout-status');
  document.querySelectorAll('[data-tier]').forEach(button => {
    button.addEventListener('click', async () => {
      const tier = button.dataset.tier;
      status.textContent = 'Checkout is not connected yet. Add your Stripe secret key to enable payments.';
      button.disabled = true;
      setTimeout(() => { button.disabled = false; }, 1200);
      console.log(`Requested ${tier} checkout`);
    });
  });
})();
