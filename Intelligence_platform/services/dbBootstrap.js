const ensureBootstrapData = async (pool) => {
  await pool.query(`
    DO $$
    BEGIN
      BEGIN
        ALTER TYPE alert_severity ADD VALUE IF NOT EXISTS 'minor';
        ALTER TYPE alert_severity ADD VALUE IF NOT EXISTS 'major';
        ALTER TYPE alert_severity ADD VALUE IF NOT EXISTS 'critical';
      EXCEPTION
        WHEN undefined_object THEN NULL;
      END;
    END $$;
  `);

  await pool.query(`
    INSERT INTO cities (name, slug, center_coords, current_status)
    VALUES ('Kochi', 'kochi', ST_SetSRID(ST_MakePoint(76.2673, 9.9312), 4326), 'Operational')
    ON CONFLICT (slug) DO NOTHING
  `);

  const { rows } = await pool.query(`SELECT city_id FROM cities WHERE slug = 'kochi' LIMIT 1`);
  const kochiCityId = rows[0]?.city_id;

  if (!kochiCityId) {
    throw new Error('Kochi city seed missing after bootstrap.');
  }

  for (const modeType of ['Metro', 'Bus', 'Water']) {
    await pool.query(
      `
      INSERT INTO transport_modes (city_id, type, is_enabled)
      SELECT $1, $2::text, true
      WHERE NOT EXISTS (
        SELECT 1 FROM transport_modes WHERE city_id = $1 AND type = $2::text
      )
      `,
      [kochiCityId, modeType]
    );
  }

  await pool.query(`
    UPDATE alerts
    SET severity = CASE
      WHEN severity::text = 'Critical' THEN 'critical'::alert_severity
      WHEN severity::text = 'Warning'  THEN 'major'::alert_severity
      WHEN severity::text = 'Info'     THEN 'minor'::alert_severity
      ELSE severity
    END
    WHERE severity::text IN ('Critical', 'Warning', 'Info')
  `);

  return kochiCityId;
};

module.exports = { ensureBootstrapData };
