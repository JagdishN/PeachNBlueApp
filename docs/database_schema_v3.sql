-- ============================================================
-- Peach & Blue — Laundry & Ironing App — Database Schema v3
-- PostgreSQL
-- Powered by NIVENXA
--
-- Change from v2: "buildings" is replaced with a generic "branches"
-- concept. A branch can be an apartment complex OR an area/locality —
-- same table, a type flag distinguishes them. Each branch has its own
-- contact/WhatsApp number (this is the number printed on that
-- branch's pickup bags/marketing and the number customers message).
-- Everything that referenced building_id now references branch_id.
-- ============================================================

-- ---------- Branches: apartment complex OR area, each with own phone ----------
CREATE TABLE branches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_name     VARCHAR(150) NOT NULL,
    branch_type     VARCHAR(20) NOT NULL CHECK (branch_type IN ('apartment', 'area')),
    phone_number    VARCHAR(15) NOT NULL,        -- the number printed on that branch's bags/marketing
    whatsapp_number VARCHAR(15),                  -- defaults to phone_number if same; customers message this
    address         TEXT NOT NULL,
    city            VARCHAR(100) NOT NULL,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Staff are typically tied to the one branch whose WhatsApp/phone
-- line they monitor. Admin can be branch-scoped too (a branch
-- manager) or NULL to mean "oversees all branches".
-- (branch_id column added to users below.)

-- ---------- App users: staff and admin ONLY (no customer login) ----------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role            VARCHAR(20) NOT NULL CHECK (role IN ('staff', 'admin')),
    branch_id       UUID REFERENCES branches(id),   -- staff: the branch line they monitor; admin: NULL = oversees all branches
    full_name       VARCHAR(150) NOT NULL,
    phone_number    VARCHAR(15) UNIQUE NOT NULL,
    password_hash   TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_users_branch ON users(branch_id);

-- ---------- Customers: reference record, NOT a login account ----------
-- Created/updated by staff or admin when an order comes in. Looked up
-- by phone number on repeat orders so history and ledger accumulate
-- under the same record instead of duplicating.
CREATE TABLE customers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name           VARCHAR(150) NOT NULL,
    phone_number        VARCHAR(15) NOT NULL,
    whatsapp_number     VARCHAR(15),               -- defaults to phone_number if same
    branch_id           UUID NOT NULL REFERENCES branches(id),
    -- location_label holds whatever identifies the customer within their
    -- branch: a flat number for an apartment-type branch (e.g. "A-304"),
    -- or a house/shop number or short address for an area-type branch
    -- (e.g. "12, Ring Road" or "Shop 4, MG Complex"). One flexible field
    -- instead of a flat-number-only column that wouldn't fit area branches.
    location_label      VARCHAR(100) NOT NULL,
    billing_mode        VARCHAR(20) NOT NULL DEFAULT 'daily'
                            CHECK (billing_mode IN ('daily', 'monthly_billing')),
    credit_limit        DECIMAL(10,2) DEFAULT 0,   -- monthly-billing customers only
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE (phone_number, branch_id, location_label)
);

CREATE INDEX idx_customers_phone ON customers(phone_number);
CREATE INDEX idx_customers_branch ON customers(branch_id, location_label);

-- ---------- Garment catalogue — admin CRUD, staff read-only ----------
CREATE TABLE garment_catalogue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id       UUID REFERENCES branches(id),   -- nullable: null = applies to all branches
    item_name       VARCHAR(100) NOT NULL,
    -- NOTE: branded bag artwork shows Wash & Fold, Ironing, and Dry
    -- Cleaning as three distinct services — confirm with client whether
    -- this enum should expand to match before backend build starts.
    service_type    VARCHAR(20) NOT NULL DEFAULT 'laundry'
                        CHECK (service_type IN ('laundry', 'iron', 'both')),
    price           DECIMAL(8,2) NOT NULL,
    is_active       BOOLEAN DEFAULT TRUE,
    display_order   INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_catalogue_branch ON garment_catalogue(branch_id);

-- ---------- Orders ----------
-- Created by staff/admin AFTER physical pickup, not by a customer.
CREATE TABLE orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number        VARCHAR(20) UNIQUE NOT NULL,
    customer_id         UUID NOT NULL REFERENCES customers(id),
    created_by          UUID NOT NULL REFERENCES users(id),   -- staff or admin who logged the order
    staff_id            UUID REFERENCES users(id),             -- staff handling pickup/delivery

    -- internal_status: full granularity for staff/admin ops tracking
    internal_status     VARCHAR(30) NOT NULL DEFAULT 'picked_up'
                            CHECK (internal_status IN ('picked_up', 'washing', 'ironing',
                                                        'ready', 'out_for_delivery', 'delivered', 'cancelled')),

    pickup_date          DATE NOT NULL,
    delivery_date          DATE,

    estimated_amount        DECIMAL(10,2) NOT NULL DEFAULT 0,   -- auto-calculated from rate master at pickup
    final_amount              DECIMAL(10,2) NOT NULL DEFAULT 0,   -- defaults to estimated_amount; admin-editable before delivery
    amount_was_revised          BOOLEAN NOT NULL DEFAULT FALSE,

    payment_method                VARCHAR(20) CHECK (payment_method IN ('qr_online', 'cash')),
    payment_status                 VARCHAR(20) NOT NULL DEFAULT 'pending'
                                    CHECK (payment_status IN ('pending', 'paid', 'partially_paid', 'due')),

    created_at                      TIMESTAMPTZ DEFAULT now(),
    updated_at                      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_staff ON orders(staff_id);
CREATE INDEX idx_orders_status ON orders(internal_status);

-- customer_facing_status is DERIVED in application logic, not stored:
--   internal_status = 'delivered'          -> "Delivered"
--   anything else (picked_up..out_for_delivery) -> "Pending" / "Picked"
-- Keeping this as a derived value (not a column) avoids the two
-- status fields drifting out of sync.

-- ---------- Order status history (internal audit trail) ----------
CREATE TABLE order_status_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status          VARCHAR(30) NOT NULL,
    changed_by      UUID REFERENCES users(id),
    changed_at      TIMESTAMPTZ DEFAULT now()
);

-- ---------- Amount revisions (admin overrides estimate before delivery) ----------
CREATE TABLE order_amount_revisions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    old_amount      DECIMAL(10,2) NOT NULL,
    new_amount      DECIMAL(10,2) NOT NULL,
    reason          TEXT NOT NULL,               -- mandatory: this text goes into the customer notification
    revised_by      UUID NOT NULL REFERENCES users(id),
    revised_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_revisions_order ON order_amount_revisions(order_id);

-- ---------- Order line items (garments recorded at pickup) ----------
CREATE TABLE order_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    garment_id      UUID NOT NULL REFERENCES garment_catalogue(id),
    item_name       VARCHAR(100) NOT NULL,     -- snapshot at time of order
    quantity        INT NOT NULL CHECK (quantity > 0),
    unit_price      DECIMAL(8,2) NOT NULL,     -- snapshot at time of order
    line_total      DECIMAL(10,2) NOT NULL
);

CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ---------- Payments ----------
CREATE TABLE payments (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id                UUID REFERENCES orders(id),        -- nullable: monthly settlements aren't tied to one order
    customer_id             UUID NOT NULL REFERENCES customers(id),
    amount                  DECIMAL(10,2) NOT NULL,
    payment_type             VARCHAR(20) NOT NULL CHECK (payment_type IN ('order_payment', 'monthly_settlement', 'partial_settlement')),
    payment_method             VARCHAR(20) NOT NULL CHECK (payment_method IN ('qr_online', 'cash')),
    razorpay_payment_id         VARCHAR(100),
    razorpay_order_id            VARCHAR(100),
    status                        VARCHAR(20) NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
    recorded_by                    UUID NOT NULL REFERENCES users(id),  -- staff/admin who marked it
    notes                            TEXT,
    created_at                        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_payments_customer ON payments(customer_id);
CREATE INDEX idx_payments_order ON payments(order_id);

-- ---------- Monthly ledger (running balance per customer) ----------
CREATE TABLE ledger_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     UUID NOT NULL REFERENCES customers(id),
    order_id        UUID REFERENCES orders(id),
    entry_type      VARCHAR(20) NOT NULL CHECK (entry_type IN ('charge', 'payment', 'adjustment')),
    amount          DECIMAL(10,2) NOT NULL,       -- positive = charge, negative = payment/credit
    balance_after    DECIMAL(10,2) NOT NULL,
    description        TEXT,
    created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ledger_customer ON ledger_entries(customer_id, created_at);

-- ---------- Monthly statements ----------
CREATE TABLE monthly_statements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID NOT NULL REFERENCES customers(id),
    statement_month      DATE NOT NULL,
    opening_balance        DECIMAL(10,2) NOT NULL DEFAULT 0,
    total_charges            DECIMAL(10,2) NOT NULL DEFAULT 0,
    total_paid                 DECIMAL(10,2) NOT NULL DEFAULT 0,
    closing_balance              DECIMAL(10,2) NOT NULL DEFAULT 0,
    pdf_url                        TEXT,
    whatsapp_sent_at                 TIMESTAMPTZ,
    reminder_sent_at                   TIMESTAMPTZ,
    generated_at                         TIMESTAMPTZ DEFAULT now(),
    UNIQUE (customer_id, statement_month)
);

CREATE INDEX idx_statements_customer ON monthly_statements(customer_id);

-- ---------- Invoices ----------
CREATE TABLE invoices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            UUID NOT NULL REFERENCES orders(id) UNIQUE,
    invoice_number       VARCHAR(30) UNIQUE NOT NULL,
    pdf_url                TEXT,
    qr_code_url             TEXT,                -- Razorpay payment QR, used on every bill now (not just monthly billing)
    created_at                TIMESTAMPTZ DEFAULT now()
);

-- ---------- Communications log ----------
-- Every WhatsApp/SMS sent to a customer, across the whole lifecycle:
-- pickup confirmation, amount revision notice, delivery confirmation,
-- payment receipt, monthly statement, overdue reminder. One table
-- covers all of them since there's no in-app inbox to check instead.
--
-- IMPORTANT: WhatsApp and SMS are sent TOGETHER on every notification,
-- not one as a fallback for the other. Each send attempt creates its
-- own row (channel = 'whatsapp' and channel = 'sms'), so a single
-- customer event (e.g. delivery confirmation) always produces TWO
-- rows here, each with its own independent status.
CREATE TABLE communications_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     UUID NOT NULL REFERENCES customers(id),
    order_id        UUID REFERENCES orders(id),          -- nullable: monthly statements/reminders aren't order-specific
    message_type    VARCHAR(30) NOT NULL
                        CHECK (message_type IN ('pickup_confirmation', 'amount_revision',
                                                 'delivery_confirmation', 'payment_receipt',
                                                 'monthly_statement', 'payment_reminder')),
    channel         VARCHAR(20) NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
    status          VARCHAR(20) NOT NULL DEFAULT 'sent'
                        CHECK (status IN ('sent', 'failed')),
    sent_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_comms_customer ON communications_log(customer_id, sent_at);

-- ---------- Staff daily earnings summary ----------
CREATE TABLE staff_earnings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id            UUID NOT NULL REFERENCES users(id),
    earning_date         DATE NOT NULL,
    orders_completed        INT NOT NULL DEFAULT 0,
    total_collected           DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at                  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (staff_id, earning_date)
);

-- ============================================================
-- Notes:
-- 1. No customer login/auth table — "customers" is a plain reference
--    record, looked up/created by phone number when staff logs a new
--    order. This is the core structural change from v1.
-- 2. "branches" (v3) replaces "buildings" (v2) — a branch can be an
--    apartment complex OR an area/locality, each with its own contact
--    number (this is the number printed on that branch's bags and the
--    number customers message on WhatsApp). This is the generic
--    version of the earlier "service zones" idea, now a first-class
--    concept rather than something deferred to a future add-on.
-- 3. Staff are scoped to one branch (users.branch_id) since each staff
--    member monitors a specific branch's WhatsApp/phone line. Admin
--    can be scoped to one branch (a branch manager) or left NULL to
--    mean "sees all branches" — the app's admin views should filter
--    by branch when a scoped admin is logged in.
-- 4. Auto-assignment/dispatch logic within a branch (if staff count per
--    branch ever grows past 1-2) can still be added later as a
--    staff_zone_assignments table without touching this structure.
-- 5. order_amount_revisions.reason is mandatory by design — it's the
--    same text that gets sent to the customer, so there's no
--    separate "internal note" vs "customer message" to keep in sync.
-- ============================================================
