// Where Premium is sold. Fill this in once the store product exists; nothing else in the code needs to change.
//
//   provider: 'lemonsqueezy' | 'gumroad' | 'none'
//     'none'  -> the Premium page says "coming soon" and nothing can be bought yet (free features all work).
//   checkoutUrl: the page people buy on (Lemon Squeezy "Share" link or Gumroad product page).
//   priceLabel:  shown on the button, e.g. '$6.99 one-time'. Keep it in sync with the store.
//   lemonsqueezy.storeId / productIds: from the Lemon Squeezy dashboard. A key is only accepted if it was sold by
//     this store (and, if productIds is not empty, for one of these products), so keys from other shops can't unlock it.
//   gumroad.productId: the product's ID from Gumroad (Product > Content > License key section).
//   maxActivations: how many browsers one key may unlock (Lemon Squeezy enforces its own limit too).
export const PREMIUM_CONFIG = {
  provider: 'none',
  checkoutUrl: '',
  priceLabel: '',
  lemonsqueezy: { storeId: 0, productIds: [] },
  gumroad: { productId: '' },
  maxActivations: 3,
};
