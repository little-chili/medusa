import { IsObject, IsOptional, IsString } from "class-validator"

import { EntityManager } from "typeorm"
import { PaymentCollectionService } from "../../../../services"

/**
 * @oas [post] /payment-collections/{id}
 * operationId: "PostPaymentCollectionsPaymentCollection"
 * summary: "Updates a PaymentCollection"
 * description: "Updates a PaymentCollection."
 * x-authenticated: true
 * parameters:
 *   - (path) id=* {string} The ID of the PaymentCollection.
 * requestBody:
 *   content:
 *     application/json:
 *       schema:
 *         $ref: "#/components/schemas/AdminUpdatePaymentCollectionsReq"
 * x-codeSamples:
 *   - lang: JavaScript
 *     label: JS Client
 *     source: |
 *       import Medusa from "@medusajs/medusa-js"
 *       const medusa = new Medusa({ baseUrl: MEDUSA_BACKEND_URL, maxRetries: 3 })
 *       // must be previously logged in or use api token
 *       medusa.admin.paymentCollections.update(payment_collection_id, {
 *         description: "Description of payCol"
 *       })
 *         .then(({ payment_collection }) => {
 *           console.log(payment_collection.id)
 *         })
 *   - lang: Shell
 *     label: cURL
 *     source: |
 *       curl --location --request POST 'https://medusa-url.com/admin/payment-collections/{id}' \
 *       --header 'Authorization: Bearer {api_token}' \
 *       --header 'Content-Type: application/json' \
 *       --data-raw '{
 *           "description": "Description of payCol"
 *       }'
 * security:
 *   - api_token: []
 *   - cookie_auth: []
 * tags:
 *   - PaymentCollection
 * responses:
 *   200:
 *     description: OK
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             payment_collection:
 *               $ref: "#/components/schemas/PaymentCollection"
 *   "400":
 *     $ref: "#/components/responses/400_error"
 *   "401":
 *     $ref: "#/components/responses/unauthorized"
 *   "404":
 *     $ref: "#/components/responses/not_found_error"
 *   "409":
 *     $ref: "#/components/responses/invalid_state_error"
 *   "422":
 *     $ref: "#/components/responses/invalid_request_error"
 *   "500":
 *     $ref: "#/components/responses/500_error"
 */
export default async (req, res) => {
  const { id } = req.params
  const data = req.validatedBody as AdminUpdatePaymentCollectionsReq

  const paymentCollectionService: PaymentCollectionService = req.scope.resolve(
    "paymentCollectionService"
  )

  const manager: EntityManager = req.scope.resolve("manager")
  const paymentCollection = await manager.transaction(
    async (transactionManager) => {
      return await paymentCollectionService
        .withTransaction(transactionManager)
        .update(id, data)
    }
  )

  res.status(200).json({ payment_collection: paymentCollection })
}

/**
 * @schema AdminUpdatePaymentCollectionsReq
 * type: object
 * properties:
 *   description:
 *     description: An optional description to create or update the payment collection.
 *     type: string
 *   metadata:
 *     description: An optional set of key-value pairs to hold additional information.
 *     type: object
 */
export class AdminUpdatePaymentCollectionsReq {
  @IsString()
  @IsOptional()
  description?: string

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>
}
