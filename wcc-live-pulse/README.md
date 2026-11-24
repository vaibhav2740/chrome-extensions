# WCC 2026 Live Pulse ♟️⚡

A minimalist, high-fidelity Chrome Extension (Manifest V3) delivering real-time win probabilities, clock hazard telemetry, and move-by-move analytics for the **2026 FIDE World Chess Championship** (D. Gukesh vs. Javokhir Sindarov).

Designed with a sleek **Cyber-Liquid Glass** aesthetic inspired by the *Krillion Bot* popup (`backdrop-filter: blur(20px)`, atmospheric gradient orbs, and dynamic segmented probability meters).

---

## 🌟 Key Features

* **Live Win Probability Engine:**
  * Real-time calculation of **White Win**, **Draw**, and **Black Win** probabilities.
  * Direct integration with the official FIDE/Lichess broadcast DGT feed (`xLgOJ6cb`).
  * Overall 14-game classical match championship expectancy tracker.
* **Zero-Increment Clock Hazard Modeling:**
  * Tracks remaining time on both player clocks down to the second.
  * Real-time **Pace Indicator** ($\tau = T / M_{\text{rem}}$ minutes per move).
  * Accounts for the lethal **zero-increment cliff** before move 40 under official FIDE match regulations.
  * Live clock delta badge (`+35m 30s` lead for White).
* **Positional & Model Telemetry:**
  * Raw engine centipawns + time hazard penalty + Elo/form prior $\to$ Unified Effective Evaluation ($E_{\text{eff}}$).
  * Current move number and active turn indicator (`Move 14 · White to move`).
  * Last move played tracking (`13... Bd7`).
* **Liquid-Glass UI Aesthetic:**
  * Ultra-polished frosted glass surfaces with high-contrast typography.
  * Light / Dark mode dynamic adaptation via CSS custom properties.
  * Live status pulse dot with auto-sync every 15 seconds.

---

## 📐 Mathematical Formulation

The extension's probability engine calculates live odds using a multi-factor Bayesian logistic framework:

1. **Baseline Berlin Draw Expectation:**
   $$D_{\text{base}}(E) = D_{\max} \cdot \exp\left( -\frac{E^2}{2\sigma_D^2} \right)$$
2. **Zero-Increment Time Hazard Shift:**
   $$\Delta E_{\text{time}} = \alpha \cdot \left(\frac{40 - m}{40}\right) \cdot \ln\left(\frac{\tau_W}{\tau_B}\right)$$
3. **Rating & Form Prior:**
   $$\Delta E_{\text{form}} = \left(\frac{\Delta R + \Delta F}{400}\right) \cdot \gamma$$
4. **Effective Evaluation & Decisive Partitioning:**
   $$E_{\text{eff}} = E_{\text{engine}} + \Delta E_{\text{time}} + \Delta E_{\text{form}}$$
   $$W_{\text{decisive}} = \frac{1}{1 + 10^{-E_{\text{eff}} \cdot 1.6}}$$

---

## 🚀 How to Install in Chrome

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the extension directory:
   ```bash
   ~/personal/chrome-extensions/wcc-live-pulse
   ```
5. Pin **WCC Live Pulse** to your toolbar for instant one-click match analytics!
