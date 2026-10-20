-- Stock is derived, never stored. These views turn the movement tables into levels.
-- Every *_movements view has a `day` column, so stock "as of" a date is just `WHERE day < $date`.

-- Which pile each stitching stage takes balls from and adds them to, per workflow and construction.
-- Work entries for a stage that doesn't apply to the ball type (e.g. quarter stitching on a 2-piece)
-- match no row here and are ignored, the same as in the prototype.
CREATE VIEW stage_flow AS
SELECT * FROM (VALUES
  ('hand_quarter_stitching'::stage,    'hand'::workflow, '4pc'::construction, 'cut'::wip_buffer, 'cups'::wip_buffer),
  ('hand_closing',                     'hand',           '4pc',               'cups',            'closed'),
  ('hand_closing',                     'hand',           '2pc',               'cut',             'closed'),
  ('hand_seam_stitching',              'hand',           '4pc',               'closed',          'awaiting_grading'),
  ('hand_seam_stitching',              'hand',           '2pc',               'closed',          'awaiting_grading'),
  ('machine_quarter_stitching',        'machine',        '4pc',               'cut',             'cups'),
  ('machine_stitching',                'machine',        '4pc',               'cups',            'machine_stitched'),
  ('machine_stitching',                'machine',        '2pc',               'cut',             'machine_stitched'),
  ('machine_closing_seam',             'machine',        '4pc',               'machine_stitched','awaiting_grading'),
  ('machine_closing_seam',             'machine',        '2pc',               'machine_stitched','awaiting_grading')
) AS f(stage, workflow, construction, takes_from, adds_to);
--> statement-breakpoint

CREATE VIEW wip_movements AS
SELECT w.day, w.ball_type_id, 'cut'::wip_buffer AS buffer, w.good::numeric AS qty
FROM work_entries w
JOIN ball_types b ON b.id = w.ball_type_id
WHERE w.stage = 'cutting'
UNION ALL
SELECT w.day, w.ball_type_id, f.takes_from, -((w.good + w.rejected)::numeric)
FROM work_entries w
JOIN ball_types b ON b.id = w.ball_type_id
JOIN stage_flow f ON f.stage = w.stage AND f.workflow = b.workflow AND f.construction = b.construction
UNION ALL
SELECT w.day, w.ball_type_id, f.adds_to, w.good::numeric
FROM work_entries w
JOIN ball_types b ON b.id = w.ball_type_id
JOIN stage_flow f ON f.stage = w.stage AND f.workflow = b.workflow AND f.construction = b.construction
UNION ALL
SELECT g.day, g.ball_type_id, 'awaiting_grading'::wip_buffer, -(g.qty::numeric)
FROM gradings g
UNION ALL
SELECT a.day, a.ball_type_id, a.buffer, a.delta
FROM stock_adjustments a
WHERE a.target = 'wip';
--> statement-breakpoint

CREATE VIEW wip_levels AS
SELECT ball_type_id, buffer, SUM(qty) AS qty
FROM wip_movements
GROUP BY ball_type_id, buffer;
--> statement-breakpoint

CREATE VIEW ready_stock_movements AS
SELECT g.day, g.ball_type_id, g.grade_id, g.qty::numeric AS qty
FROM gradings g
WHERE NOT g.rejected
UNION ALL
SELECT d.delivered_on, l.ball_type_id, l.grade_id, -(l.qty::numeric)
FROM delivery_lines l
JOIN deliveries d ON d.id = l.delivery_id
UNION ALL
SELECT a.day, a.ball_type_id, a.grade_id, a.delta
FROM stock_adjustments a
WHERE a.target = 'ready_stock';
--> statement-breakpoint

CREATE VIEW ready_stock AS
SELECT ball_type_id, grade_id, SUM(qty) AS qty
FROM ready_stock_movements
GROUP BY ball_type_id, grade_id;
--> statement-breakpoint

-- Leather is used by the sheets on cutting rows; one cork core per ball closed (good or rejected).
-- Other materials only change through purchases and counts.
CREATE VIEW material_movements AS
SELECT p.received_on AS day, p.material_id, p.qty::numeric AS qty
FROM purchases p
UNION ALL
SELECT w.day, w.leather_id, -(w.sheets::numeric)
FROM work_entries w
WHERE w.stage = 'cutting' AND w.leather_id IS NOT NULL AND w.sheets IS NOT NULL
UNION ALL
SELECT w.day, m.id, -((w.good + w.rejected)::numeric)
FROM work_entries w
JOIN ball_types b ON b.id = w.ball_type_id
JOIN materials m ON m.kind = 'cork'
WHERE (w.stage = 'hand_closing' AND b.workflow = 'hand')
   OR (w.stage = 'machine_closing_seam' AND b.workflow = 'machine')
UNION ALL
SELECT a.day, a.material_id, a.delta
FROM stock_adjustments a
WHERE a.target = 'material';
--> statement-breakpoint

CREATE VIEW material_on_hand AS
SELECT m.id AS material_id, COALESCE(SUM(mm.qty), 0) AS qty
FROM materials m
LEFT JOIN material_movements mm ON mm.material_id = m.id
GROUP BY m.id;
