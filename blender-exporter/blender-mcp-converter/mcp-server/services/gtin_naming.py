"""GTIN Naming Service handling CSV/XLSX lookups for filename generation."""

import csv
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import openpyxl

logger = logging.getLogger(__name__)


@dataclass
class GTINEntry:
    """Normalized record describing one GTIN/article mapping."""

    gtin: Optional[str]
    article_number: Optional[str]
    product_name: Optional[str]
    color_code: Optional[str]
    finish_suffix: Optional[str]
    raw: Dict[str, Optional[str]]

    def to_dict(self) -> Dict[str, Optional[str]]:
        """Return a serializable representation for API responses."""
        return {
            "gtin": self.gtin,
            "article_number": self.article_number,
            "product_name": self.product_name,
            "color_code": self.color_code,
            "finish_suffix": self.finish_suffix,
            "raw": self.raw,
        }


class GTINNamingService:
    """Resolve filenames using GTIN/article mappings from CSV or XLSX data."""

    def __init__(self, database_path: Optional[str] = None):
        self.database_path = database_path or os.getenv("GTIN_DATABASE_PATH")
        self.enabled = os.getenv("GTIN_ENABLED", "false").lower() == "true"

        # Column configuration (case-insensitive lookup)
        self.gtin_column = os.getenv("GTIN_COLUMN_NAME", "GTIN").strip()
        self.name_column = os.getenv("PRODUCT_NAME_COLUMN", "ProductName").strip()
        self.article_column = os.getenv("ARTICLE_NUMBER_COLUMN", "Artikelnummer").strip()
        self.color_column = os.getenv("COLOR_CODE_COLUMN", "RAL").strip()
        self.finish_column = os.getenv("FINISH_SUFFIX_COLUMN", "Finish").strip()

        # Filename defaults
        self.default_suffix = os.getenv("GTIN_DEFAULT_SUFFIX", "vzk").strip()
        self.default_extension = os.getenv("GTIN_DEFAULT_EXTENSION", ".glb").strip()

        self.default_suffix = (
            self._sanitize_filename(self.default_suffix).strip("_")
            if self.default_suffix
            else ""
        )

        # Internal caches for quick lookups
        self.gtin_cache: Dict[str, GTINEntry] = {}
        self.article_cache: Dict[str, GTINEntry] = {}
        
        # Store for all entries (used for row count)
        self.gtin_database: List[GTINEntry] = []

        if self.enabled and self.database_path:
            self._load_database()
        elif self.enabled:
            logger.warning("GTIN naming enabled but GTIN_DATABASE_PATH not configured")
        else:
            logger.info("GTIN naming disabled")

    # ------------------------------------------------------------------
    # Data loading
    # ------------------------------------------------------------------
    def reload_database(self) -> None:
        """Reload the GTIN database from disk."""
        # Re-read database path from environment (in case it was updated by upload)
        self.database_path = os.getenv("GTIN_DATABASE_PATH", self.database_path)
        
        self.gtin_cache.clear()
        self.article_cache.clear()
        self.gtin_database.clear()
        
        if self.enabled and self.database_path:
            self._load_database()
            logger.info(f"GTIN database reloaded: {len(self.gtin_database)} entries from {self.database_path}")
        else:
            logger.warning("Cannot reload: GTIN naming disabled or no database path")
    
    def _load_database(self) -> None:
        if not self.database_path or not Path(self.database_path).exists():
            logger.warning(f"GTIN database not found: {self.database_path}")
            return

        file_ext = Path(self.database_path).suffix.lower()

        try:
            if file_ext in {".xlsx", ".xls"}:
                self._load_xlsx()
            elif file_ext == ".csv":
                self._load_csv()
            else:
                logger.error(f"Unsupported GTIN database format: {file_ext}")
                return

            logger.info(
                "Loaded %s GTIN mappings (%s)",
                len(self.gtin_cache),
                Path(self.database_path).name,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to load GTIN database: %s", exc)

    def _load_xlsx(self) -> None:
        workbook = openpyxl.load_workbook(self.database_path, read_only=True)
        try:
            worksheet = workbook.active
            header_row = next(worksheet.iter_rows(min_row=1, max_row=1, values_only=True))
            header_map = {
                (str(cell).strip().lower() if cell is not None else ""): idx
                for idx, cell in enumerate(header_row)
            }

            def idx_for(column: str) -> Optional[int]:
                return header_map.get(column.lower()) if column else None

            gtin_idx = idx_for(self.gtin_column)
            name_idx = idx_for(self.name_column)
            article_idx = idx_for(self.article_column)
            color_idx = idx_for(self.color_column)
            finish_idx = idx_for(self.finish_column)

            if gtin_idx is None and article_idx is None:
                logger.error(
                    "GTIN database missing both GTIN and article columns (expected %s/%s)",
                    self.gtin_column,
                    self.article_column,
                )
                return

            for row in worksheet.iter_rows(min_row=2, values_only=True):
                entry_kwargs = {
                    "gtin": self._normalize_gtin(self._extract_cell(row, gtin_idx)),
                    "article_number": self._normalize_article(
                        self._extract_cell(row, article_idx)
                    ),
                    "product_name": self._normalize_product_name(
                        self._extract_cell(row, name_idx)
                    ),
                    "color_code": self._normalize_color(self._extract_cell(row, color_idx)),
                    "finish_suffix": self._normalize_suffix(
                        self._extract_cell(row, finish_idx)
                    ),
                    "raw": {
                        "gtin": self._extract_cell(row, gtin_idx, raw=True),
                        "article_number": self._extract_cell(row, article_idx, raw=True),
                        "product_name": self._extract_cell(row, name_idx, raw=True),
                        "color_code": self._extract_cell(row, color_idx, raw=True),
                        "finish_suffix": self._extract_cell(row, finish_idx, raw=True),
                    },
                }

                self._store_entry(entry_kwargs)
        finally:
            workbook.close()

    def _load_csv(self) -> None:
        with open(self.database_path, "r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)

            for row in reader:
                normalized_row = {
                    (key or "").strip().lower(): (value or "").strip()
                    for key, value in row.items()
                }

                def cell(column: str) -> Optional[str]:
                    if not column:
                        return None
                    return normalized_row.get(column.lower())

                entry_kwargs = {
                    "gtin": self._normalize_gtin(cell(self.gtin_column)),
                    "article_number": self._normalize_article(cell(self.article_column)),
                    "product_name": self._normalize_product_name(cell(self.name_column)),
                    "color_code": self._normalize_color(cell(self.color_column)),
                    "finish_suffix": self._normalize_suffix(cell(self.finish_column)),
                    "raw": {
                        "gtin": cell(self.gtin_column),
                        "article_number": cell(self.article_column),
                        "product_name": cell(self.name_column),
                        "color_code": cell(self.color_column),
                        "finish_suffix": cell(self.finish_column),
                    },
                }

                self._store_entry(entry_kwargs)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _extract_cell(
        self, row: Tuple[Optional[str], ...], index: Optional[int], raw: bool = False
    ) -> Optional[str]:
        if index is None or index >= len(row):
            return None
        value = row[index]
        if raw:
            return None if value is None else str(value)
        return self._clean_string(value)

    @staticmethod
    def _clean_string(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _sanitize_filename(value: str) -> str:
        cleaned = value
        for char in '<>:"/\\|?*':
            cleaned = cleaned.replace(char, "")
        cleaned = cleaned.replace(" ", "_")
        if len(cleaned) > 80:
            cleaned = cleaned[:80]
        return cleaned

    def _normalize_gtin(self, gtin: Optional[str]) -> Optional[str]:
        if gtin is None:
            return None
        digits = "".join(ch for ch in gtin if ch.isdigit())
        return digits or None

    def _normalize_article(self, article: Optional[str]) -> Optional[str]:
        if article is None:
            return None
        return self._sanitize_filename(article).strip("_") or None

    def _normalize_product_name(self, name: Optional[str]) -> Optional[str]:
        if name is None:
            return None
        return self._sanitize_filename(name).strip("_") or None

    def _normalize_color(self, color: Optional[str]) -> Optional[str]:
        if color is None:
            return None
        # Convert to string and strip whitespace
        color_str = str(color).strip()
        # If it's "0" or empty, treat as no color code
        if color_str == "0" or color_str == "":
            return None
        normalized = "".join(ch for ch in color_str.upper() if ch.isalnum())
        return normalized or None

    def _normalize_suffix(self, suffix: Optional[str]) -> Optional[str]:
        if suffix is None:
            return None
        return self._sanitize_filename(suffix).strip("_") or None

    def _store_entry(self, entry_kwargs: Dict[str, Optional[str]]) -> None:
        entry = GTINEntry(**entry_kwargs)

        if not entry.gtin and not entry.article_number:
            return

        if entry.finish_suffix is None and self.default_suffix:
            entry.finish_suffix = self.default_suffix

        if entry.gtin:
            self.gtin_cache[entry.gtin] = entry

        if entry.article_number:
            self.article_cache[entry.article_number] = entry
        
        # Store in database list for row count
        self.gtin_database.append(entry)

    def _normalize_extension(self, extension: str) -> str:
        ext = extension.strip() if extension else ".glb"
        if not ext.startswith("."):
            ext = f".{ext}"
        return ext

    def _fallback_filename(self, fallback_name: str, extension: str) -> str:
        base = self._sanitize_filename(fallback_name or "output") or "output"
        return f"{base}{extension}"

    def _find_entry(
        self, gtin: Optional[str], article_number: Optional[str]
    ) -> Tuple[Optional[GTINEntry], Optional[str]]:
        normalized_gtin = self._normalize_gtin(gtin) if gtin else None
        normalized_article = self._normalize_article(article_number) if article_number else None

        if normalized_gtin and normalized_gtin in self.gtin_cache:
            return self.gtin_cache[normalized_gtin], "gtin"

        if normalized_article and normalized_article in self.article_cache:
            return self.article_cache[normalized_article], "article_number"

        return None, None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def get_filename(
        self,
        gtin: Optional[str] = None,
        article_number: Optional[str] = None,
        fallback_name: str = "output",
        extension: Optional[str] = None,
    ) -> Dict[str, object]:
        ext = self._normalize_extension(extension or self.default_extension)
        
        # If GTIN or article number provided, use that as fallback instead of generic "output"
        # Use uppercase for suffix (VZK instead of vzk)
        if gtin:
            suffix_upper = self.default_suffix.upper() if self.default_suffix else ""
            fallback_name = f"{self._normalize_gtin(gtin)}_{suffix_upper}" if suffix_upper else self._normalize_gtin(gtin)
        elif article_number:
            suffix_upper = self.default_suffix.upper() if self.default_suffix else ""
            fallback_name = f"{self._normalize_article(article_number)}_{suffix_upper}" if suffix_upper else self._normalize_article(article_number)
        
        fallback_filename = self._fallback_filename(fallback_name, ext)

        if not self.enabled:
            return {
                "success": False,
                "filename": fallback_filename,
                "using_fallback": True,
                "error": "GTIN naming service disabled",
            }

        entry, match_source = self._find_entry(gtin, article_number)
        if not entry:
            return {
                "success": False,
                "filename": fallback_filename,
                "using_fallback": True,
                "error": "No GTIN/article match found",
                "match_source": None,
            }

        # Build base prefix: GTIN_Artikelnummer_
        prefix_parts: List[str] = []
        
        # Add GTIN first (if exists)
        if entry.gtin:
            prefix_parts.append(entry.gtin)
        
        # Add article number second (if exists)
        if entry.article_number:
            prefix_parts.append(entry.article_number)
        
        base_prefix = '_'.join(prefix_parts) if prefix_parts else ""

        # Priority 1: If RAL/color code exists, use "GTIN_Artikelnummer_RAL_xxxx.glb" format
        if entry.color_code:
            if base_prefix:
                filename = f"{base_prefix}_RAL_{entry.color_code}{ext}"
            else:
                filename = f"RAL_{entry.color_code}{ext}"
        else:
            # Priority 2: Build filename as "GTIN_Artikelnummer_VZK.glb"
            parts: List[str] = []
            
            if base_prefix:
                parts.append(base_prefix)
            
            # Add finish suffix last (VZK, etc.) - uppercase
            if entry.finish_suffix:
                parts.append(entry.finish_suffix.upper())

            if parts:
                filename = f"{'_'.join(parts)}{ext}"
            else:
                filename = fallback_filename

        return {
            "success": True,
            "filename": filename,
            "using_fallback": False,
            "match_source": match_source,
            "entry": entry.to_dict(),
        }

    def search_gtin(self, query: str) -> List[Dict[str, Optional[str]]]:
        if not query:
            return []

        needle = query.strip().lower()
        results: List[Dict[str, Optional[str]]] = []
        seen: set = set()

        for entry in list(self.gtin_cache.values()) + list(self.article_cache.values()):
            haystacks: List[Optional[str]] = [
                entry.gtin,
                entry.article_number,
                entry.product_name,
                entry.color_code,
                entry.finish_suffix,
            ]

            for key in ("gtin", "article_number", "product_name", "color_code", "finish_suffix"):
                haystacks.append(entry.raw.get(key))

            if any(str(value).lower().find(needle) != -1 for value in haystacks if value):
                key = (entry.gtin, entry.article_number, entry.color_code)
                if key not in seen:
                    seen.add(key)
                    results.append(entry.to_dict())

        return results

    def reload_database(self) -> None:
        self.gtin_cache.clear()
        self.article_cache.clear()
        self._load_database()


_gtin_service: Optional[GTINNamingService] = None


def get_gtin_service() -> GTINNamingService:
    global _gtin_service
    if _gtin_service is None:
        _gtin_service = GTINNamingService()
    return _gtin_service
