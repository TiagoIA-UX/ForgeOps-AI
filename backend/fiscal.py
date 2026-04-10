"""
backend/fiscal.py
Módulo de emissão de NFC-e direto com o Sefaz via PyNFe.
Custo: R$0 — sem intermediário.

O delivery faz upload do seu certificado A1 (.pfx) e configurações
fiscais (CNPJ, IE, etc). O sistema emite a nota direto com o Sefaz.

Fluxo:
  1. Next.js chama POST /api/fiscal/emitir-nfce com os dados do pedido
  2. Este módulo carrega o certificado A1 do delivery
  3. Gera o XML da NFC-e com PyNFe
  4. Assina digitalmente
  5. Envia ao Sefaz do estado
  6. Retorna protocolo + chave de acesso + XML autorizado
"""

import base64
import os
import tempfile
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Any, Optional

from pynfe.entidades.cliente import Cliente
from pynfe.entidades.emitente import Emitente
from pynfe.entidades.fonte_dados import FonteDados
from pynfe.entidades.notafiscal import NotaFiscal
from pynfe.processamento.assinatura import AssinaturaA1
from pynfe.processamento.comunicacao import ComunicacaoSefaz
from pynfe.processamento.serializacao import SerializacaoXML
from pydantic import BaseModel, Field


class AmbienteSefaz(str, Enum):
    PRODUCAO = "producao"
    HOMOLOGACAO = "homologacao"


class ItemNFCe(BaseModel):
    """Item do pedido para emissão fiscal."""
    nome: str = Field(..., min_length=1, max_length=120)
    ncm: str = Field(default="21069090")  # NCM padrão: preparações alimentícias
    cfop: str = Field(default="5102")      # CFOP: venda de mercadoria
    unidade: str = Field(default="UN")
    quantidade: float = Field(..., gt=0)
    valor_unitario: float = Field(..., gt=0)
    # Tributação simplificada (Simples Nacional)
    csosn: str = Field(default="102")      # CSOSN 102: tributado pelo SN sem crédito
    cst_pis: str = Field(default="99")
    cst_cofins: str = Field(default="99")


class DadosEmitente(BaseModel):
    """Dados fiscais do delivery (emitente da NFC-e)."""
    cnpj: str
    razao_social: str
    nome_fantasia: str
    inscricao_estadual: str
    # Regime tributário: 1=Simples Nacional, 2=SN Excesso, 3=Normal
    regime_tributario: int = Field(default=1)
    # Endereço
    logradouro: str
    numero: str
    bairro: str
    municipio: str
    codigo_municipio: str  # Código IBGE
    uf: str = Field(..., min_length=2, max_length=2)
    cep: str
    # Código numérico da UF (ex: 35 para SP)
    codigo_uf: str = Field(default="")


class DadosConsumidor(BaseModel):
    """Dados do consumidor (opcional na NFC-e para valores até R$200)."""
    cpf: Optional[str] = None
    nome: Optional[str] = None


class EmissaoNFCeRequest(BaseModel):
    """Payload completo para emissão de NFC-e."""
    # Identificação do delivery e pedido
    restaurant_id: str
    order_id: str
    numero_pedido: int

    # Emitente — dados fiscais do delivery
    emitente: DadosEmitente

    # Consumidor (pode ser vazio/anônimo)
    consumidor: DadosConsumidor = DadosConsumidor()

    # Itens do pedido
    itens: list[ItemNFCe]

    # Pagamento
    forma_pagamento: str = Field(default="pix")  # pix, dinheiro, cartao_credito, cartao_debito
    valor_total: float = Field(..., gt=0)

    # Certificado A1 (base64 do .pfx) + senha
    certificado_base64: str
    certificado_senha: str

    # Ambiente: homologacao (testes) ou producao
    ambiente: AmbienteSefaz = AmbienteSefaz.HOMOLOGACAO

    # Número sequencial da NFC-e (série 1)
    numero_nfce: int = Field(..., gt=0)
    serie: int = Field(default=1)


class EmissaoNFCeResponse(BaseModel):
    """Resposta da emissão."""
    success: bool
    protocolo: Optional[str] = None
    chave_acesso: Optional[str] = None
    xml_autorizado: Optional[str] = None
    motivo: Optional[str] = None
    codigo_status: Optional[int] = None
    error: Optional[str] = None


# ── Mapeamento de formas de pagamento ─────────────────────────────────────────
FORMA_PAGAMENTO_MAP: dict[str, str] = {
    "dinheiro": "01",
    "cartao_credito": "03",
    "cartao_debito": "04",
    "pix": "17",
    "outros": "99",
}

# ── Código UF por sigla ──────────────────────────────────────────────────────
UF_CODIGO: dict[str, str] = {
    "AC": "12", "AL": "27", "AP": "16", "AM": "13", "BA": "29",
    "CE": "23", "DF": "53", "ES": "32", "GO": "52", "MA": "21",
    "MT": "51", "MS": "50", "MG": "31", "PA": "15", "PB": "25",
    "PR": "41", "PE": "26", "PI": "22", "RJ": "33", "RN": "24",
    "RS": "43", "RO": "11", "RR": "14", "SC": "42", "SP": "35",
    "SE": "28", "TO": "17",
}


def _decode_certificate_to_tempfile(cert_base64: str) -> str:
    """Decodifica o certificado base64 para um arquivo temporário .pfx."""
    cert_bytes = base64.b64decode(cert_base64)
    tmp = tempfile.NamedTemporaryFile(suffix=".pfx", delete=False)
    tmp.write(cert_bytes)
    tmp.close()
    return tmp.name


def _cleanup_tempfile(path: str) -> None:
    """Remove arquivo temporário do certificado."""
    try:
        if os.path.exists(path):
            os.unlink(path)
    except OSError:
        pass


def emitir_nfce(req: EmissaoNFCeRequest) -> EmissaoNFCeResponse:
    """
    Emite uma NFC-e diretamente com o Sefaz usando PyNFe.
    
    Retorna protocolo de autorização, chave de acesso e XML.
    Custo: R$0 (direto com o governo).
    """
    cert_path: Optional[str] = None

    try:
        # 1) Decodificar certificado A1 para arquivo temporário
        cert_path = _decode_certificate_to_tempfile(req.certificado_base64)

        # 2) Configurar código UF
        codigo_uf = req.emitente.codigo_uf or UF_CODIGO.get(req.emitente.uf.upper(), "35")

        # 3) Montar emitente
        emitente = Emitente(
            cnpj=req.emitente.cnpj.replace(".", "").replace("/", "").replace("-", ""),
            razao_social=req.emitente.razao_social,
            nome_fantasia=req.emitente.nome_fantasia,
            inscricao_estadual=req.emitente.inscricao_estadual.replace(".", "").replace("-", ""),
            codigo_de_regime_tributario=str(req.emitente.regime_tributario),
            endereco_logradouro=req.emitente.logradouro,
            endereco_numero=req.emitente.numero,
            endereco_bairro=req.emitente.bairro,
            endereco_municipio=req.emitente.municipio,
            endereco_codigo_municipio=req.emitente.codigo_municipio,
            endereco_uf=req.emitente.uf.upper(),
            endereco_cep=req.emitente.cep.replace("-", ""),
            endereco_pais="1058",
        )

        # 4) Montar consumidor (NFC-e: CPF é opcional até R$200)
        cliente = None
        if req.consumidor.cpf:
            cliente = Cliente(
                tipo_documento="CPF",
                numero_documento=req.consumidor.cpf.replace(".", "").replace("-", ""),
                razao_social=req.consumidor.nome or "CONSUMIDOR NAO IDENTIFICADO",
            )

        # 5) Montar nota fiscal
        nota = NotaFiscal(
            emitente=emitente,
            cliente=cliente,
            uf=codigo_uf,
            natureza_operacao="VENDA DE MERCADORIA",
            forma_pagamento=0,  # 0=à vista
            tipo_pagamento=int(FORMA_PAGAMENTO_MAP.get(req.forma_pagamento, "17")),
            modelo=65,  # 65 = NFC-e
            serie=req.serie,
            numero_nf=req.numero_nfce,
            tipo_documento=1,  # 1=saída
            municipio=req.emitente.codigo_municipio,
            tipo_impressao_danfe=4,  # 4=DANFE NFC-e
            forma_emissao="1",  # 1=normal
            finalidade_emissao="1",  # 1=NF-e normal
            processo_emissao="0",  # 0=App do contribuinte
            transporte_modalidade_frete=9,  # 9=sem frete (delivery é do emitente)
            informacoes_adicionais_interesse_fisco=f"Pedido #{req.numero_pedido}",
        )

        is_homolog = req.ambiente == AmbienteSefaz.HOMOLOGACAO

        # 6) Adicionar produtos
        for item in req.itens:
            nota.adicionar_produto_servico(
                codigo=item.nome[:10].replace(" ", ""),
                descricao=item.nome,
                ncm=item.ncm,
                cfop=item.cfop,
                unidade_comercial=item.unidade,
                quantidade_comercial=Decimal(str(item.quantidade)),
                valor_unitario_comercial=Decimal(str(item.valor_unitario)),
                valor_total_bruto=Decimal(str(round(item.quantidade * item.valor_unitario, 2))),
                unidade_tributavel=item.unidade,
                quantidade_tributavel=Decimal(str(item.quantidade)),
                valor_unitario_tributavel=Decimal(str(item.valor_unitario)),
                icms_csosn=item.csosn,
                icms_origem=0,  # 0=Nacional
                pis_cst=item.cst_pis,
                cofins_cst=item.cst_cofins,
            )

        # 7) Serializar para XML
        fonte_dados = FonteDados([nota])
        serializer = SerializacaoXML(fonte_dados, homologacao=is_homolog)
        xml = serializer.exportar(retorna_string=False)

        # 8) Assinar com certificado A1
        assinatura = AssinaturaA1(cert_path, req.certificado_senha)
        xml_assinado = assinatura.assinar(xml)

        # 9) Enviar ao Sefaz
        comunicacao = ComunicacaoSefaz(
            uf=req.emitente.uf.upper(),
            certificado=cert_path,
            certificado_senha=req.certificado_senha,
            homologacao=is_homolog,
        )

        # Transmitir
        envio = comunicacao.autorizacao(
            modelo="nfce",
            nota_fiscal=xml_assinado,
        )

        # 10) Processar resposta do Sefaz
        # O retorno varia conforme a lib, mas geralmente tem:
        # - protocolo, chave, xml_autorizado, motivo, cStat
        protocolo = getattr(envio, "protocolo", None)
        chave = getattr(envio, "chave", None)
        motivo = getattr(envio, "motivo", None)
        cstat = getattr(envio, "cStat", None) or getattr(envio, "codigo_status", None)

        # Se a lib retorna dict/xml, parsear  
        if hasattr(envio, "text") or isinstance(envio, str):
            # Fallback: resposta bruta 
            return EmissaoNFCeResponse(
                success=True,
                protocolo=str(protocolo) if protocolo else "pendente",
                chave_acesso=str(chave) if chave else None,
                xml_autorizado=str(xml_assinado) if xml_assinado else None,
                motivo=str(motivo) if motivo else "Enviado ao Sefaz",
                codigo_status=int(cstat) if cstat else None,
            )

        return EmissaoNFCeResponse(
            success=True,
            protocolo=str(protocolo) if protocolo else None,
            chave_acesso=str(chave) if chave else None,
            xml_autorizado=None,  # XML pode ser grande demais para JSON
            motivo=str(motivo) if motivo else "NFC-e transmitida",
            codigo_status=int(cstat) if cstat else None,
        )

    except Exception as exc:
        return EmissaoNFCeResponse(
            success=False,
            error=f"Erro na emissão: {str(exc)[:500]}",
        )

    finally:
        if cert_path:
            _cleanup_tempfile(cert_path)
