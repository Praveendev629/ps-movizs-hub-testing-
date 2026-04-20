"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
  
export default function AnimePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  useEffect(() => {
    // Minimum loading time for smooth transition
    const timer = setTimeout(() => {
      if (iframeLoaded) {
        setLoading(false);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [iframeLoaded]);

  return (
    <div className="h-screen bg-[#050505] text-white overflow-hidden">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-black/80 border-b border-red-600/20">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/")}
              className="p-2 hover:bg-red-600/10 rounded-xl border border-red-600/20 text-zinc-400 hover:text-red-500 transition-all"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <img
                src="https://slelguoygbfzlpylpxfs.supabase.co/storage/v1/render/image/public/project-uploads/edc22665-6f69-41bf-966e-691d920b92da/WhatsApp_Image_2026-01-27_at_10.41.17_PM-removebg-preview-1769562285410.png?width=8000&height=8000&resize=contain"
                alt="Logo"
                className="w-10 h-10 object-contain"
              />
              <span className="text-xl font-bold tracking-tight">
                p.s <span className="text-red-600">movizs</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase tracking-widest text-red-500">
              Animes Collection
            </span>
          </div>
        </div>
      </header>

      {/* Loading Screen */}
      {loading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#050505]">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center"
          >
            <Loader2 className="w-12 h-12 text-red-600 animate-spin mx-auto mb-4" />
            <p className="text-zinc-400 font-medium">Loading Animes Collection...</p>
          </motion.div>
        </div>
      )}

      {/* Iframe Container */}
      <div className="relative w-full" style={{ height: "calc(100dvh - 64px)" }}>
        <iframe
          src="/anime-wrapper.html"
          className="w-full border-0"
          onLoad={() => {
            setIframeLoaded(true);
            setTimeout(() => setLoading(false), 500);
          }}
          sandbox="allow-same-origin allow-scripts"
          title="Animes Collection"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          style={{ height: "calc(100dvh - 64px)" }}
        />
      </div>
    </div>
  );
}
