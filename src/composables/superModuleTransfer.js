import Swal from "sweetalert2"
import { useSuperModules } from "./useSuperModules.js"

const { get, registerDefinition, ready: superModulesReady } = useSuperModules()

/** Récupère les super-modules référencés (récursivement) par un graphe. */
export function collectSuperModules(graph) {
  return useSuperModules().collectDefinitions(graph)
}

/**
 * Enregistre les super-modules portés par un fichier d'importation AVANT
 * l'importation du synthé/patch qui les référence.
 *
 * - les définitions invalides ou dupliquées sont ignorées ;
 * - si un super-module du même nom existe déjà, une fenêtre demande si on
 *   écrase (tous) ou si on annule l'importation (sauf en mode silencieux,
 *   où l'on ignore simplement les définitions en conflit) ;
 * - retourne true pour continuer l'importation, false si elle est annulée.
 */
export async function installSuperModulesFromFile(defs, { silent = false } = {}) {
  if (!Array.isArray(defs) || !defs.length) return true
  await superModulesReady

  const seen = new Set()
  const valid = []
  for (const d of defs) {
    if (!d || !d.type || !d.graph?.modules?.length) continue
    if (seen.has(d.type)) continue
    seen.add(d.type)
    valid.push(d)
  }
  if (!valid.length) return true

  const conflicts = valid.filter((d) => get(d.type))
  if (conflicts.length && silent) {
    const conflicting = new Set(conflicts.map((d) => d.type))
    for (let i = valid.length - 1; i >= 0; i--) {
      if (conflicting.has(valid[i].type)) valid.splice(i, 1)
    }
    if (!valid.length) return true
  } else if (conflicts.length) {
    const names = [...new Set(conflicts.map((d) => `« ${d.label || d.type} »`))].join(", ")
    const res = await Swal.fire({
      title: "Super-module(s) déjà présent(s)",
      html:
        `Le fichier contient le(s) super-module(s) ${names}, ` +
        `déjà présent(s) sur ce poste.<br><br>` +
        `Écraser avec la version du fichier ?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Écraser",
      cancelButtonText: "Annuler l'importation",
    })
    if (!res.isConfirmed) return false
  }

  for (const def of valid) {
    try {
      registerDefinition(def)
    } catch (err) {
      Swal.fire({
        title: "Super-module invalide",
        text: err.message,
        icon: "error",
        confirmButtonText: "OK",
      })
      return false
    }
  }
  return true
}