# Access lock — read before sharing

The Node/Express version enforces owner-only pricing and security changes on the server, not just by hiding tabs.

- Students open the site directly; no staff tabs are shown.
- Select **Rider / Owner Login**, choose **Rider**, and enter the default PIN `2222`.
- Choose **Owner** and enter the default password `uccboss2026` for pricing, commission, profit and credential controls.
- In the Owner panel, use the security form to change both credentials before sharing the public URL. New owner passwords need at least 8 characters; rider PINs must be exactly 4 digits.
- Use **Lock** when finished on a shared device. Refreshing the page also returns to Student view.
- Share the deployed server URL only. Keep this project ZIP, database and credentials private.

## Demo and production limitations

**GasGo-UCC-Website.html is an offline demonstration, not a secure deployment.** All its code, passwords and data are on the viewer's device and can be inspected or modified. Changes are local to that browser; this file cannot coordinate real student/rider orders.

The server-backed app has role checks but is still a launch prototype: credentials currently reside in a private JSON file and are sent in request headers. Before a real public launch, use HTTPS, hashed credentials, revocable secure sessions, rate limiting for all authentication attempts, individual rider accounts and a persistent production database. Order-ID/phone lookup is a convenience demo, not verified identity: add SMS OTP or authenticated student accounts and private tracking tokens before using real personal data. Do not put `data/db.json` in the public directory or publish it in a public repository.

**Payments and wallet payouts are simulated.** No money is collected or transferred. Connect a payment provider, verify signed webhooks and transaction amounts server-side, and only then dispatch paid orders. Commission shown is gross delivery commission, not net profit after processing fees and operating costs. The current delivery completion button does not validate the student's delivery PIN; add server-side PIN validation before operating.

Use persistent storage from the first cloud deployment: ephemeral disks can discard orders and changed credentials on restart/redeploy. Replace the JSON file with a managed database (or a private persistent volume for a single-instance pilot).

---

# GasGo UCC — Complete Ghana Launch & Paystack MoMo Guide

This folder (`/home/user/ucc-gasgo`) contains your working **Bolt-style Campus LPG Refill & Delivery Web Application** built specifically for **University of Cape Coast (UCC)** students, delivery riders, and you (the platform owner).

---

## 1. How Your Bolt-Style Profit Formula Works

Every order separates **Cooking Gas Money** from the **Delivery Fee** so students trust your pricing and you never lose money when NPA changes fuel prices:

$$\text{Student Total Paid} = \text{Gas Refill Cost} + \text{Zone Delivery Fee}$$

Then the **Delivery Fee** is automatically split between the delivery guy and your profit:

- **Gas Refill Cost (100%)** $\rightarrow$ Goes to refill the cylinder at the LPG pump (e.g., Pacific Gas Station or Allied LPG).
- **Rider Payout (e.g., 80% of Delivery Fee)** $\rightarrow$ Paid to the motorbike / Aboboyaa rider who picks up and returns the cylinder.
- **Your Platform Profit (e.g., 20% of Delivery Fee)** $\rightarrow$ Kept automatically in your account on every single order.

### Example Order (6 kg Cylinder in Ayensu Diaspora)
| Item | Amount (GH₵) | Who Gets It? |
| :--- | :---: | :--- |
| **6 kg LPG Refill** (`6 kg × GH₵ 15.50/kg`) | GH₵ 93.00 | LPG Filling Station Pump |
| **Ayensu Delivery Fee** (Paid by student) | GH₵ 15.00 | Split below (80% / 20%) |
| **Total Student Pays via MoMo** | **GH₵ 108.00** | Collected at checkout |
| ├─ *Delivery Guy's Cut (80%)* | **GH₵ 12.00** | Rider's MoMo Wallet |
| └─ **Your Net Profit (20%)** | **GH₵ 3.00** | **Your Owner Wallet** |

> **Scaling at UCC:** With ~50 student cylinders refilled per day across Ayensu, Amamoma, Kwaprow, Apewosika, and SRC/PSI hostels at an average GH₵ 15 delivery fee (20% cut = GH₵ 3.00/order), your platform nets **GH₵ 150/day (~GH₵ 4,500/month)** with zero inventory risk.

---

## 2. Connecting Real MTN MoMo, Telecel Cash & AT Money (Paystack Ghana)

In Ghana, **Paystack** (or **Hubtel**) is the easiest way to collect Mobile Money on a website and split payouts automatically.

### Step A: Register Your Paystack Ghana Account
1. Go to [paystack.com/gh](https://paystack.com/gh) and create a **Ghana** account.
2. Submit your **Ghana Card** and your **MTN MoMo number or Ghana Bank Account** for settlement.
3. Under **Settings → API Keys & Webhooks**, copy your `PAYSTACK_SECRET_KEY` (`sk_live_...`) and `PAYSTACK_PUBLIC_KEY` (`pk_live_...`).

### Step B: Two Ways to Handle the Money Split in Ghana

#### Option 1: Paystack Split Payments (Best if partnering with 1–2 LPG Stations)
Create a Paystack **Subaccount** for your partner LPG station (or your dedicated Rider Float MoMo wallet) and pass `transaction_charge` so Paystack keeps your exact profit + rider pool:

```javascript
// Example: Initialize real Paystack Ghana MoMo Checkout inside server.js
const response = await fetch('https://api.paystack.co/transaction/initialize', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: `${studentPhone}@gasgoucc.com`,
    amount: Math.round(totalPaid * 100), // Paystack uses pesewas (GH₵ 108.00 = 10800)
    currency: 'GHS',
    channels: ['mobile_money', 'card'],
    metadata: {
      orderId,
      studentName,
      studentPhone,
      gasCost,
      deliveryFee,
      riderPayout,
      platformProfit
    }
  })
});
```

#### Option 2: Automated Rider MoMo Payout on Delivery PIN Confirmation (True Bolt Model)
1. Student pays the full **GH₵ 108.00** into your Paystack collection balance.
2. When the rider picks up the empty cylinder and arrives at the LPG station, your backend sends **`GH₵ 93.00`** directly to the station's MoMo merchant till (or rider's gas float).
3. Once the student gives the rider the **4-digit Delivery PIN** confirming safe return, your backend triggers a Paystack Transfer of **`GH₵ 12.00`** to the rider's MoMo number — leaving your **`GH₵ 3.00` net profit** untouched!

---

## 3. Adding SMS Alerts for UCC Students & Riders (Arkesel / Hubtel Ghana)

Students love getting an SMS with their **Cylinder Security Tag** and **Delivery PIN** (even if their hostel Wi-Fi or data drops).
- Sign up at **Arkesel.com** (popular Ghanaian SMS API, ~GH₵ 0.035 per SMS) and get a Sender ID like `GasGoUCC`.
- Send an automatic SMS when:
  1. Order is paid: *"GasGo UCC: Order ORD-UCC-8045 confirmed! Ensure rider attaches tag TAG-519. Give PIN 4829 only after receiving your filled cylinder."*
  2. Rider is returning: *"Your filled 6kg cylinder is on the way back to Baduwa Hostel!"*

---

## 4. UCC Cape Coast Operations Checklist

1. **Target High-DemandLPG Student Communities:**
   - **Diaspora Hostels (Highest Volume):** Ayensu, Amamoma, Kwaprow, Apewosika, Akotokyir, Ola/Pedu.
   - **Campus Halls Permitting Cooking:** SRC Hall, Superannuation Hall, PSI Hostel, Graduate Hostel *(Note: Traditional halls like Casford, Valco, Atlantic, Oguaa, and Adehye restrict indoor LPG use—focus marketing on Diaspora & SRC/Superannuation).*
2. **Prevent Cylinder Mix-Ups 100%:**
   - Buy packs of cheap waterproof **numbered plastic zip-ties/tags** in Cape Coast or Accra.
   - Rider locks the tag onto the cylinder valve guard right in front of the student before leaving the hostel room.
   - Rider brings back the **printed pump receipt** from Pacific Gas / GOIL showing exact kg & GH₵ pumped.
3. **Recruit Trusted Riders:**
   - Start with **2–3 motorbike riders or 1 Aboboyaa tricycle** (Aboboyaa is great on Saturday mornings for batch-refilling 8–10 cylinders at once from Ayensu/Kwaprow!).

---

## 5. How to Put This Website Online (Live Public URL)

1. Copy the `/home/user/ucc-gasgo` folder to a **GitHub** repository.
2. Create a free/starter Web Service on **[Render.com](https://render.com)** or **[Railway.app](https://railway.app)**:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
3. Replace `data/db.json` with a managed database before launch, or attach a private persistent volume for a single-instance pilot, so orders and credentials survive redeployments.
4. Connect a custom domain like `gasgoucc.com` (~$11/yr on Namecheap or Cloudflare) and share QR flyers at Science Market, Ayensu Junction, and hostel noticeboards!
