"""
Fetch municipality address coordinates from IBGE Censo 2022 – Coordenadas dos Endereços.
ZIPs per municipality contain CSV with domicile type and lat/lon.
Base: https://ftp.ibge.gov.br/.../Censo_Demografico_2022/Coordenadas_enderecos/Municipio/{UF_CODE}_{UF}/
"""

import logging
import zipfile
from io import BytesIO, StringIO
from typing import Any, Dict, List, Optional

import pandas as pd

from .municipios import load_municipios, resolve_municipio

log = logging.getLogger(__name__)

BASE_URL_2022 = (
    "https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/"
    "Censo_Demografico_2022/Arquivos_CNEFE/CSV/Municipio"
)


def _download_zip(url: str, timeout: int = 120) -> bytes:
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "AmostraBrasil-Python/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _find_zip_name_for_codibge(folder_url: str, codibge: str) -> str:
    """
    List the UF folder HTML and find the ZIP whose name starts with the given codibge.

    IBGE pattern: {codibge}_NOME_MUNICIPIO.csv.zip (or similar).
    We search for links like 'codibge*.zip' in the index page.
    """
    import re

    import requests

    resp = requests.get(folder_url, timeout=60)
    resp.raise_for_status()
    html = resp.text
    # Look for href="<codibge>something.zip"
    pattern = re.compile(r'href="(?P<name>' + re.escape(codibge) + r'[^"]*\.zip)"', re.IGNORECASE)
    m = pattern.search(html)
    if not m:
        raise ValueError(f"Nenhum arquivo ZIP encontrado para codibge={codibge} em {folder_url}")
    return m.group("name")


def _find_lat_lon_columns(df: pd.DataFrame) -> tuple:
    """Return (lat_col, lon_col) from dataframe; try common IBGE/CNEFE names."""
    cols_upper = {c.upper(): c for c in df.columns}
    lat_name = None
    for name in ("LATITUDE", "NU_LATITUDE", "LAT", "LAT_Y"):
        if name in cols_upper:
            lat_name = name
            break
    lon_name = None
    for name in ("LONGITUDE", "NU_LONGITUDE", "LON", "LONG", "LNG", "LON_X"):
        if name in cols_upper:
            lon_name = name
            break
    if lat_name and lon_name:
        return cols_upper[lat_name], cols_upper[lon_name]
    return None, None


def _find_tipo_column(df: pd.DataFrame) -> Optional[str]:
    """Return column name for domicile type if present (name or code e.g. COD_ESPECIE)."""
    cols_upper = {c.upper(): c for c in df.columns}
    for name in (
        "NM_TIPO_ESTABELECIMENTO",
        "CD_TIPO_ESTABELECIMENTO",
        "COD_ESPECIE",
        "TIPO_ESTABELECIMENTO",
        "TIPO",
        "TIPO_DOMICILIO",
    ):
        if name in cols_upper:
            return cols_upper[name]
    return None


def _parse_csv_from_zip(zip_bytes: bytes) -> pd.DataFrame:
    """Extract first CSV from ZIP and return DataFrame. Tries sep=; and ,."""
    with zipfile.ZipFile(BytesIO(zip_bytes), "r") as z:
        csv_names = [n for n in z.namelist() if n.lower().endswith(".csv")]
        if not csv_names:
            raise ValueError("No CSV file found in ZIP")
        with z.open(csv_names[0]) as f:
            raw = f.read().decode("utf-8", errors="replace")
    sep = ";"
    for s in (";", ","):
        try:
            trial = pd.read_csv(StringIO(raw), sep=s, nrows=5, low_memory=False)
            if len(trial.columns) >= 2:
                sep = s
                break
        except Exception:
            continue
    return pd.read_csv(StringIO(raw), sep=sep, low_memory=False)


def fetch_municipio_coords_2022(
    codibge: str = "",
    municipio: str = "",
    municipios_df: Optional[pd.DataFrame] = None,
    n_sample: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Download 2022 CNEFE coordinates ZIP for a municipality and return list of points.

    Each point has keys: lat, lng, tipo (when available), and any other CSV columns
    normalized to lowercase.

    Parameters
    ----------
    codibge : str
        IBGE 7-digit municipality code.
    municipio : str
        Municipality name (alternative to codibge).
    municipios_df : pandas.DataFrame, optional
        Municipality table (UF, MUNICIPIO, CODIBGE). If None, load_municipios() is used.
    n_sample : int, optional
        If set, return a random sample of this many points (for large municipalities).

    Returns
    -------
    list of dict
        Each dict: lat, lng, tipo (or None), plus optional endIBGE, setor, etc.
    """
    if municipios_df is None:
        municipios_df = load_municipios()
    mun = resolve_municipio(codibge=codibge, municipio=municipio, municipios_df=municipios_df)
    if len(mun) == 0:
        log.debug("resolve_municipio: no match for codibge=%r municipio=%r", codibge, municipio)
        raise ValueError(f"Município não encontrado: codibge={codibge!r}, municipio={municipio!r}")
    if len(mun) > 1:
        raise ValueError(
            f"Multiple municipalities match. Use codibge. Matches:\n{mun[['UF', 'CODIBGE', 'MUNICIPIO']].to_string()}"
        )
    row = mun.iloc[0]
    codibge = str(row["CODIBGE"]).zfill(7)
    uf = row["UF"]
    folder = f"{codibge[:2]}_{uf}"
    folder_url = f"{BASE_URL_2022.rstrip('/')}/{folder}/"
    zip_name = _find_zip_name_for_codibge(folder_url, codibge)
    url = f"{folder_url}{zip_name}"
    log.info("cnefe2022: fetching folder=%s zip=%s url=%s", folder_url, zip_name, url)
    zip_bytes = _download_zip(url)
    df = _parse_csv_from_zip(zip_bytes)
    lat_col, lon_col = _find_lat_lon_columns(df)
    if lat_col is None or lon_col is None:
        raise ValueError(
            f"CSV does not contain latitude/longitude columns. Found: {list(df.columns)}"
        )
    tipo_col = _find_tipo_column(df)
    df = df.dropna(subset=[lat_col, lon_col])
    df[lat_col] = pd.to_numeric(df[lat_col], errors="coerce")
    df[lon_col] = pd.to_numeric(df[lon_col], errors="coerce")
    # IBGE CNEFE 2022: LATITUDE/LONGITUDE vêm como inteiros em microssegundos de grau.
    # Ex.: -23567890 -> -23.567890 graus decimais.
    if lat_col.upper() in {"LATITUDE", "NU_LATITUDE"} and lon_col.upper() in {
        "LONGITUDE",
        "NU_LONGITUDE",
    }:
        df[lat_col] = df[lat_col] / 1_000_000.0
        df[lon_col] = df[lon_col] / 1_000_000.0
    df = df.dropna(subset=[lat_col, lon_col])
    if n_sample is not None and n_sample > 0 and len(df) > n_sample:
        df = df.sample(n=n_sample, random_state=42)
    out = []
    for _, r in df.iterrows():
        pt = {
            "lat": float(r[lat_col]),
            "lng": float(r[lon_col]),
            "tipo": str(r[tipo_col]) if tipo_col and pd.notna(r.get(tipo_col)) else None,
        }
        for c in df.columns:
            if c not in (lat_col, lon_col, tipo_col) and pd.notna(r.get(c)):
                key = c.lower().replace(" ", "_")
                pt[key] = r[c]
        out.append(pt)
    return out
