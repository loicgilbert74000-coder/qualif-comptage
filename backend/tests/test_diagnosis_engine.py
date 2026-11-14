from app.services.diagnosis_engine import diagnose


def test_chute_on_index_meter_is_ambiguous():
    d = diagnose(
        subtype="chute",
        anomaly_type="incoherence",
        measurement_kind="index",
        fluid_type="gaz",
        role="général",
        deviation_pct=-80.0,
    )
    assert d.recommended_action == "a_decider"
    assert "remplacement" in d.diagnosis or "remise à zéro" in d.diagnosis


def test_pic_on_index_meter_suggests_correction():
    d = diagnose(
        subtype="pic",
        anomaly_type="incoherence",
        measurement_kind="index",
        fluid_type="gaz",
        role="général",
        deviation_pct=120.0,
    )
    assert d.recommended_action == "corriger"


def test_negative_value_on_production_meter_is_ambiguous():
    d = diagnose(
        subtype="valeur_negative",
        anomaly_type="incoherence",
        measurement_kind="consommation",
        fluid_type="électricité",
        role="production",
        deviation_pct=None,
    )
    assert d.recommended_action == "a_decider"


def test_negative_value_on_consumption_meter_suggests_correction():
    d = diagnose(
        subtype="valeur_negative",
        anomaly_type="incoherence",
        measurement_kind="consommation",
        fluid_type="électricité",
        role="général",
        deviation_pct=None,
    )
    assert d.recommended_action == "corriger"


def test_missing_delivery_suggests_manual_check():
    d = diagnose(
        subtype="absence_releve",
        anomaly_type="manquante",
        measurement_kind="livraison",
        fluid_type="mazout",
        role="livraison",
        deviation_pct=None,
    )
    assert d.recommended_action == "a_decider"


def test_missing_load_curve_suggests_correction():
    d = diagnose(
        subtype="absence_releve",
        anomaly_type="manquante",
        measurement_kind="consommation",
        fluid_type="électricité",
        role="général",
        deviation_pct=None,
    )
    assert d.recommended_action == "corriger"
