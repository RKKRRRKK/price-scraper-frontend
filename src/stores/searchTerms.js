import { defineStore } from 'pinia'
import { v4 as uuid } from 'uuid'
import dayjs from 'dayjs'

export const useSearchTerms = defineStore('searchTerms', {
  state: () => ({
    terms: [
      {
        id: uuid(),
        marketplace: 'kleinanzeigen',
        term: 'Nikon Z 50mm f/1.8 S',
        primeOnly: false,
        include: ['ovp', 'rechnung'],
        exclude: ['defekt', 'pilz'],
        url: 'https://www.google.com',
        lowestPrice: 479.0,
        lastChanged: '2025-04-21T09:30:00.000Z',
      },
      {
        id: uuid(),
        marketplace: 'kleinanzeigen',
        term: 'Nikon Z 24-120mm f/4 S',
        primeOnly: false,
        include: [],
        exclude: ['beschädigt'],
        url: 'https://www.google.com',
        lowestPrice: 999.0,
        lastChanged: '2025-04-19T15:12:00.000Z',
      },
      {
        id: uuid(),
        marketplace: 'bazos',
        term: 'Nikon Z 14-30mm f/4 S',
        primeOnly: false,
        include: ['orig balenie'],
        exclude: ['poškodený'],
        url: 'https://www.google.com',
        lowestPrice: 849.0,
        lastChanged: '2025-04-22T11:05:00.000Z',
      },
      {
        id: uuid(),
        marketplace: 'bazos',
        term: 'Nikon Z 85mm f/1.8 S',
        primeOnly: false,
        include: [],
        exclude: ['škrabanec'],
        url: 'https://www.google.com',
        lowestPrice: 629.0,
        lastChanged: '2025-04-20T08:47:00.000Z',
      },
    ],
  }),

  getters: {
    termsByMarketplace: (state) => (mp) => state.terms.filter((t) => t.marketplace === mp),
  },

  actions: {
    addTerm({ marketplace, term, primeOnly, include, exclude, url = 'https://www.google.com' }) {
      this.terms.push({
        id: uuid(),
        marketplace,
        term,
        primeOnly,
        include,
        exclude,
        url,
        lowestPrice: null,
        lastChanged: null,
      })
    },
    removeTerm(id) {
      this.terms = this.terms.filter((t) => t.id !== id)
    },
    updatePrice(id, price) {
      const t = this.terms.find((t) => t.id === id)
      if (t) {
        t.lowestPrice = price
        t.lastChanged = dayjs().toISOString()
      }
    },
    touch(id) {
      const t = this.terms.find((t) => t.id === id)
      if (t) t.lastChanged = dayjs().toISOString()
    },
  },

  persist: false,
})
