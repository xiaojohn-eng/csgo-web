"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, Network, RefreshCw } from "lucide-react";
import "./lan-addresses.css";

function shareableUrls(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const info = payload as { lanUrls?: unknown; urls?: unknown };
  const candidates = Array.isArray(info.lanUrls)
    ? info.lanUrls
    : Array.isArray(info.urls)
      ? info.urls
      : [];
  return [
    ...new Set(
      candidates.flatMap((candidate: unknown) => {
        if (typeof candidate !== "string") return [];
        try {
          const url = new URL(candidate);
          if (
            !["http:", "https:"].includes(url.protocol) ||
            url.username ||
            url.password ||
            ["localhost", "::1", "[::1]", "0.0.0.0"].includes(url.hostname) ||
            url.hostname.startsWith('127.')
          )
            return [];
          return [url.href];
        } catch {
          return [];
        }
      }),
    ),
  ];
}

async function copyUrl(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Plain HTTP LAN pages may not expose the Clipboard API.
    }
  }
  const previousFocus = document.activeElement;
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.appendChild(field);
  let copied = false;
  try {
    field.select();
    copied = document.execCommand("copy");
  } finally {
    field.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
  }
  if (!copied) throw new Error("manual-copy-needed");
}

export function LANAddresses({originalDust2=false}:{originalDust2?:boolean}={}) {
  const [urls, setUrls] = useState<string[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [revision, setRevision] = useState(0);
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState(false);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const titleId = useId();

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => controller.abort(), 8000);
    setPhase("loading");
    fetch("/api/server-info", { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("server-info-unavailable");
        return response.json() as Promise<unknown>;
      })
      .then((info) => {
        if (disposed) return;
        setUrls(shareableUrls(info).map(value=>{const url=new URL(value);if(originalDust2)url.searchParams.set('map','de_dust2');return url.href;}));
        setPhase("ready");
      })
      .catch(() => {
        if (disposed) return;
        setUrls([]);
        setPhase("error");
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [revision,originalDust2]);

  useEffect(() => () => clearTimeout(feedbackTimer.current), []);

  const copy = async (url: string) => {
    setCopyError(false);
    clearTimeout(feedbackTimer.current);
    try {
      await copyUrl(url);
      setCopied(url);
      feedbackTimer.current = setTimeout(() => setCopied(""), 2500);
    } catch {
      setCopied("");
      setCopyError(true);
    }
  };

  return (
    <section className="lan-addresses" aria-labelledby={titleId} aria-busy={phase === "loading"}>
      <header className="lan-addresses__header">
        <span className="lan-addresses__icon">
          <Network size={15} />
        </span>
        <h3 id={titleId}>邀请同网好友</h3>
        <span className="lan-addresses__tag">LAN</span>
        <button
          type="button"
          className="lan-addresses__refresh"
          onClick={() => setRevision((value) => value + 1)}
          disabled={phase === "loading"}
          aria-label="刷新局域网地址"
          title="刷新地址"
        >
          <RefreshCw size={13} />
        </button>
      </header>
      <p className="lan-addresses__help">
        好友连接同一 Wi-Fi 或局域网，打开下方地址，再输入你的房间码。
      </p>
      {phase === "loading" && (
        <p className="lan-addresses__message" role="status">
          正在读取房主地址…
        </p>
      )}
      {phase === "ready" && urls.length > 0 && (
        <ul className="lan-addresses__list">
          {urls.map((url, index) => (
            <li key={url} className="lan-addresses__row">
              <span className="lan-addresses__index">{String(index + 1).padStart(2, "0")}</span>
              <input
                aria-label={`局域网地址 ${index + 1}`}
                value={url}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => void copy(url)}
                className="lan-addresses__copy"
                aria-label={`复制局域网地址 ${index + 1}`}
              >
                {copied === url ? <Check size={13} /> : <Copy size={13} />}
                <span>{copied === url ? "已复制" : "复制"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {phase === "ready" && urls.length === 0 && (
        <p className="lan-addresses__message">
          尚未获取可分享的局域网地址。请在房主电脑启动局域网服务，并确认已连接网络。
        </p>
      )}
      {phase === "error" && (
        <p className="lan-addresses__message">
          暂时无法读取房主地址，请确认游戏服务正在运行后刷新。
        </p>
      )}
      <p className="lan-addresses__feedback" role="status" aria-live="polite">
        {copyError
          ? "自动复制未成功。点击地址全选，再按 ⌘C / Ctrl+C 复制。"
          : copied
            ? "链接已复制。将链接和房间码一起分享给好友。"
            : urls.length > 1 && phase === "ready"
              ? "发现多个网络地址，请使用与好友位于同一网段的地址。"
              : "对战期间，请保持房主电脑和游戏服务运行。"}
      </p>
    </section>
  );
}

export default LANAddresses;
