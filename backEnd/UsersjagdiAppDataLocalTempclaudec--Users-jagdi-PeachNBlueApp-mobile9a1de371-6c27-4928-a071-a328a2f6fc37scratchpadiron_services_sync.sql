BEGIN;

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Kurti', 'ironing', false, 'Iron Services — Women''s Wear', 'per_piece', 15, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Kurti' AND category = 'Iron Services — Women''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Leggings', 'ironing', false, 'Iron Services — Women''s Wear', 'per_piece', 12, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Leggings' AND category = 'Iron Services — Women''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Palazzo', 'ironing', false, 'Iron Services — Women''s Wear', 'per_piece', 18, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Palazzo' AND category = 'Iron Services — Women''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Top', 'ironing', false, 'Iron Services — Women''s Wear', 'per_piece', 15, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Top' AND category = 'Iron Services — Women''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Cotton Saree', 'ironing', false, 'Iron Services — Women''s Wear', 'per_piece', 40, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Cotton Saree' AND category = 'Iron Services — Women''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Silk Saree', 'ironing', false, 'Iron Services — Women''s Wear', 'per_piece', 80, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Silk Saree' AND category = 'Iron Services — Women''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Designer Saree', 'ironing', false, 'Iron Services — Women''s Wear', 'per_piece', 100, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Designer Saree' AND category = 'Iron Services — Women''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Salwar Suit (Complete Set)', 'ironing', false, 'Iron Services — Women''s Wear', 'per_piece', 40, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Salwar Suit (Complete Set)' AND category = 'Iron Services — Women''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Dupatta', 'ironing', false, 'Iron Services — Women''s Wear', 'per_piece', 12, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Dupatta' AND category = 'Iron Services — Women''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Gown', 'ironing', false, 'Iron Services — Women''s Wear', 'per_piece', 50, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Gown' AND category = 'Iron Services — Women''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Lehenga', 'ironing', false, 'Iron Services — Women''s Wear', 'per_piece', 120, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Lehenga' AND category = 'Iron Services — Women''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Long Frock', 'ironing', false, 'Iron Services — Women''s Wear', 'per_piece', 18, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Long Frock' AND category = 'Iron Services — Women''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Nighty', 'ironing', false, 'Iron Services — Women''s Wear', 'per_piece', 20, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Nighty' AND category = 'Iron Services — Women''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Hand Towel', 'ironing', false, 'Iron Services — Home Linen', 'per_piece', 10, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Hand Towel' AND category = 'Iron Services — Home Linen' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Bath Towel', 'ironing', false, 'Iron Services — Home Linen', 'per_piece', 20, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Bath Towel' AND category = 'Iron Services — Home Linen' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Pillow Cover', 'ironing', false, 'Iron Services — Home Linen', 'per_piece', 10, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Pillow Cover' AND category = 'Iron Services — Home Linen' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Bed Sheet (Single)', 'ironing', false, 'Iron Services — Home Linen', 'per_piece', 25, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Bed Sheet (Single)' AND category = 'Iron Services — Home Linen' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Bed Sheet (Double)', 'ironing', false, 'Iron Services — Home Linen', 'per_piece', 35, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Bed Sheet (Double)' AND category = 'Iron Services — Home Linen' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Blanket', 'ironing', false, 'Iron Services — Home Linen', 'per_piece', 80, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Blanket' AND category = 'Iron Services — Home Linen' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Curtain (Per Panel)', 'ironing', true, 'Iron Services — Home Linen', 'per_piece', 40, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Curtain (Per Panel)' AND category = 'Iron Services — Home Linen' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'T-Shirt', 'ironing', false, 'Iron Services — Men''s Wear', 'per_piece', 14, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'T-Shirt' AND category = 'Iron Services — Men''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Shirt', 'ironing', false, 'Iron Services — Men''s Wear', 'per_piece', 14, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Shirt' AND category = 'Iron Services — Men''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Polo T-Shirt', 'ironing', false, 'Iron Services — Men''s Wear', 'per_piece', 16, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Polo T-Shirt' AND category = 'Iron Services — Men''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Jeans', 'ironing', false, 'Iron Services — Men''s Wear', 'per_piece', 18, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Jeans' AND category = 'Iron Services — Men''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Cotton Pants', 'ironing', false, 'Iron Services — Men''s Wear', 'per_piece', 18, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Cotton Pants' AND category = 'Iron Services — Men''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Trousers/Formals', 'ironing', false, 'Iron Services — Men''s Wear', 'per_piece', 18, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Trousers/Formals' AND category = 'Iron Services — Men''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Shorts', 'ironing', false, 'Iron Services — Men''s Wear', 'per_piece', 12, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Shorts' AND category = 'Iron Services — Men''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Kurta', 'ironing', false, 'Iron Services — Men''s Wear', 'per_piece', 20, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Kurta' AND category = 'Iron Services — Men''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Blazer', 'ironing', false, 'Iron Services — Men''s Wear', 'per_piece', 80, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Blazer' AND category = 'Iron Services — Men''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Suit (2-Piece)', 'ironing', false, 'Iron Services — Men''s Wear', 'per_piece', 120, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Suit (2-Piece)' AND category = 'Iron Services — Men''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Suit (3-Piece)', 'ironing', false, 'Iron Services — Men''s Wear', 'per_piece', 150, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Suit (3-Piece)' AND category = 'Iron Services — Men''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Waistcoat', 'ironing', false, 'Iron Services — Men''s Wear', 'per_piece', 35, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Waistcoat' AND category = 'Iron Services — Men''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Hoodie Jacket', 'ironing', false, 'Iron Services — Men''s Wear', 'per_piece', 20, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Hoodie Jacket' AND category = 'Iron Services — Men''s Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'T-Shirt', 'ironing', false, 'Iron Services — Kids Wear', 'per_piece', 10, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'T-Shirt' AND category = 'Iron Services — Kids Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Shirt', 'ironing', false, 'Iron Services — Kids Wear', 'per_piece', 10, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Shirt' AND category = 'Iron Services — Kids Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Shorts', 'ironing', false, 'Iron Services — Kids Wear', 'per_piece', 10, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Shorts' AND category = 'Iron Services — Kids Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Pants', 'ironing', false, 'Iron Services — Kids Wear', 'per_piece', 10, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Pants' AND category = 'Iron Services — Kids Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Frock', 'ironing', false, 'Iron Services — Kids Wear', 'per_piece', 15, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Frock' AND category = 'Iron Services — Kids Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'School Uniform (Shirt + Pant/Skirt)', 'ironing', false, 'Iron Services — Kids Wear', 'per_piece', 20, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'School Uniform (Shirt + Pant/Skirt)' AND category = 'Iron Services — Kids Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Silk Shirt', 'ironing', true, 'Iron Services — Delicate & Premium Wear', 'per_piece', 30, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Silk Shirt' AND category = 'Iron Services — Delicate & Premium Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Linen Shirt', 'ironing', true, 'Iron Services — Delicate & Premium Wear', 'per_piece', 25, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Linen Shirt' AND category = 'Iron Services — Delicate & Premium Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Khadi Kurta', 'ironing', true, 'Iron Services — Delicate & Premium Wear', 'per_piece', 25, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Khadi Kurta' AND category = 'Iron Services — Delicate & Premium Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Wool Coat', 'ironing', true, 'Iron Services — Delicate & Premium Wear', 'per_piece', 100, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Wool Coat' AND category = 'Iron Services — Delicate & Premium Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Sherwani', 'ironing', true, 'Iron Services — Delicate & Premium Wear', 'per_piece', 150, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Sherwani' AND category = 'Iron Services — Delicate & Premium Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Bridal Dupatta', 'ironing', true, 'Iron Services — Delicate & Premium Wear', 'per_piece', 80, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Bridal Dupatta' AND category = 'Iron Services — Delicate & Premium Wear' AND branch_id IS NULL);

INSERT INTO garment_catalogue (id, branch_id, item_name, service_type, requires_special_care, category, pricing_unit, price, is_starting_price, icon_key, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'Designer Dress', 'ironing', true, 'Iron Services — Delicate & Premium Wear', 'per_piece', 100, false, NULL, true, 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM garment_catalogue WHERE item_name = 'Designer Dress' AND category = 'Iron Services — Delicate & Premium Wear' AND branch_id IS NULL);

COMMIT;
